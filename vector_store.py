"""
vector_store.py — Pinecone vector store for AI QE Agent

Indexes test cases and requirements as embeddings so the pipeline can
retrieve semantically similar tests before generating new ones, preventing
duplicate test generation.

Embedding model : all-MiniLM-L6-v2  (384-dim, sentence-transformers)
Index           : ai-qe-agent        (cosine, Pinecone free tier)
Run             : python vector_store.py
"""

import os
import sys
import time
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Pinecone ──────────────────────────────────────────────────────────────────
try:
    from pinecone import Pinecone, ServerlessSpec
except ImportError:
    sys.exit("pinecone not installed — run: pip3 install pinecone")

# ── Sentence-Transformers ─────────────────────────────────────────────────────
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    sys.exit("sentence-transformers not installed — run: pip3 install sentence-transformers")

# ── Config ────────────────────────────────────────────────────────────────────
INDEX_NAME  = os.environ.get("PINECONE_INDEX", "ai-qe-agent")
DIMENSION   = 384
METRIC      = "cosine"
EMBED_MODEL = "all-MiniLM-L6-v2"

# ── Globals (lazy-initialised) ────────────────────────────────────────────────
_pc:     Pinecone            | None = None
_index                               = None
_embedder: SentenceTransformer | None = None


# ═══════════════════════════════════════════════════════════════════════════════
# Initialisation helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _get_client() -> Pinecone:
    global _pc
    if _pc is None:
        api_key = os.environ.get("PINECONE_API_KEY", "")
        if not api_key:
            raise EnvironmentError(
                "PINECONE_API_KEY not set — add it to .env or export it."
            )
        _pc = Pinecone(api_key=api_key)
    return _pc


def _get_index():
    global _index
    if _index is not None:
        return _index

    pc = _get_client()
    existing = [idx.name for idx in pc.list_indexes()]

    if INDEX_NAME not in existing:
        print(f"  Creating index '{INDEX_NAME}' ({DIMENSION}-dim, {METRIC})…")
        pc.create_index(
            name=INDEX_NAME,
            dimension=DIMENSION,
            metric=METRIC,
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        # Wait until index is ready
        for _ in range(30):
            status = pc.describe_index(INDEX_NAME).status
            if status.get("ready"):
                break
            time.sleep(2)
        print(f"  Index ready.")
    else:
        print(f"  Index '{INDEX_NAME}' already exists — connecting.")

    _index = pc.Index(INDEX_NAME)
    return _index


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        print(f"  Loading embedding model '{EMBED_MODEL}'…")
        _embedder = SentenceTransformer(EMBED_MODEL)
    return _embedder


def _embed(text: str) -> list[float]:
    """Return a 384-dim embedding for text."""
    embedder = _get_embedder()
    vector = embedder.encode(text, normalize_embeddings=True)
    return vector.tolist()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Document Indexer
# ═══════════════════════════════════════════════════════════════════════════════

def index_document(
    doc_id: str,
    text: str,
    metadata: dict,
) -> bool:
    """
    Embed text and upsert into Pinecone.

    metadata keys: agent (str), doc_type (str), timestamp (ISO str)
    Returns True on success, False on any error.
    """
    try:
        index  = _get_index()
        vector = _embed(text)

        # Pinecone metadata must be flat strings/numbers/bools
        safe_meta = {
            "text":      text[:500],           # store truncated text for retrieval
            "agent":     metadata.get("agent", "unknown"),
            "doc_type":  metadata.get("doc_type", "test_case"),
            "timestamp": metadata.get("timestamp", datetime.now(timezone.utc).isoformat()),
        }

        index.upsert(vectors=[{"id": doc_id, "values": vector, "metadata": safe_meta}])
        return True

    except Exception as exc:
        print(f"  [ERROR] index_document({doc_id}): {exc}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Semantic Search
# ═══════════════════════════════════════════════════════════════════════════════

def search_similar(query: str, top_k: int = 3) -> list[dict]:
    """
    Embed query and return top_k similar documents.

    Each result: {doc_id, score, metadata}
    """
    try:
        index   = _get_index()
        vector  = _embed(query)
        results = index.query(vector=vector, top_k=top_k, include_metadata=True)

        hits = []
        for match in results.matches:
            hits.append({
                "doc_id":   match.id,
                "score":    round(match.score, 4),
                "metadata": match.metadata,
            })
        return hits

    except Exception as exc:
        print(f"  [ERROR] search_similar: {exc}")
        return []


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Test Case Retriever
# ═══════════════════════════════════════════════════════════════════════════════

def find_similar_test_cases(requirement: str, top_k: int = 3) -> list[dict]:
    """
    Given a new requirement string, retrieve the most similar existing test
    cases from the index. Use this before generating new tests to avoid
    duplicates.

    Returns list of {doc_id, score, text, agent} dicts.
    """
    hits = search_similar(requirement, top_k=top_k)
    results = []
    for h in hits:
        meta = h.get("metadata", {})
        results.append({
            "doc_id":   h["doc_id"],
            "score":    h["score"],
            "text":     meta.get("text", ""),
            "agent":    meta.get("agent", ""),
            "doc_type": meta.get("doc_type", ""),
        })
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Demo Runner
# ═══════════════════════════════════════════════════════════════════════════════

SAMPLE_TESTS = [
    ("TC001", "Login with valid credentials",       "ManualTestGenerator"),
    ("TC002", "Login with invalid password",         "ManualTestGenerator"),
    ("TC003", "Create new task with valid data",     "ManualTestGenerator"),
    ("TC004", "Delete existing task",                "ManualTestGenerator"),
    ("TC005", "Search tasks by keyword",             "ManualTestGenerator"),
]

SEARCH_QUERY = "user authentication test"


def _banner(title: str) -> None:
    W = 66
    print("\n" + "═" * W)
    print(f"  {title}")
    print("═" * W)


def demo() -> None:
    print("\n╔══════════════════════════════════════════════════════════════╗")
    print("║   AI QE AGENT — Pinecone Vector Store Demo                  ║")
    print("║   sentence-transformers/all-MiniLM-L6-v2  •  384-dim cosine ║")
    print("╚══════════════════════════════════════════════════════════════╝")

    # ── Connect / create index ──────────────────────────────────────────────
    _banner("STEP 1 — Connect to Pinecone & ensure index exists")
    try:
        _get_index()
    except EnvironmentError as exc:
        sys.exit(f"\n[FATAL] {exc}")
    except Exception as exc:
        sys.exit(f"\n[FATAL] Pinecone connection failed: {exc}")

    # ── Index sample test cases ─────────────────────────────────────────────
    _banner("STEP 2 — Index 5 sample test cases")
    ts = datetime.now(timezone.utc).isoformat()

    for doc_id, text, agent in SAMPLE_TESTS:
        ok = index_document(
            doc_id=doc_id,
            text=text,
            metadata={"agent": agent, "doc_type": "test_case", "timestamp": ts},
        )
        status = "✓ indexed" if ok else "✗ FAILED"
        print(f"  {status}  [{doc_id}] {text}")

    # Pinecone is eventually consistent — give it a moment
    time.sleep(2)

    # ── Semantic search ─────────────────────────────────────────────────────
    _banner(f"STEP 3 — Semantic search: \"{SEARCH_QUERY}\"")
    hits = search_similar(SEARCH_QUERY, top_k=3)

    if not hits:
        print("  No results returned.")
    else:
        print(f"  Top {len(hits)} results:\n")
        for i, h in enumerate(hits, 1):
            meta = h["metadata"]
            print(f"  #{i}  [{h['doc_id']}]  score={h['score']:.4f}")
            print(f"       text  : {meta.get('text', '')}")
            print(f"       agent : {meta.get('agent', '')}  |  type: {meta.get('doc_type', '')}")
            print()

    # ── Duplicate-prevention retriever ──────────────────────────────────────
    _banner("STEP 4 — Duplicate prevention: find_similar_test_cases()")
    new_req = "verify login flow with wrong password"
    print(f"  New requirement: \"{new_req}\"\n")
    similar = find_similar_test_cases(new_req, top_k=3)

    if not similar:
        print("  No similar tests found — safe to generate new ones.")
    else:
        print("  Similar existing tests (review before generating new ones):\n")
        for tc in similar:
            flag = "⚠ HIGH OVERLAP" if tc["score"] >= 0.85 else "~ similar"
            print(f"  {flag}  [{tc['doc_id']}]  score={tc['score']:.4f}")
            print(f"           {tc['text']}\n")

    # ── Summary ─────────────────────────────────────────────────────────────
    _banner("DONE")
    print(f"  Index : {INDEX_NAME}")
    print(f"  Docs  : {len(SAMPLE_TESTS)} test cases indexed")
    print(f"  View  : https://app.pinecone.io\n")


if __name__ == "__main__":
    demo()
