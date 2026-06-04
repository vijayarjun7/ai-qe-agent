"""
api_server.py — Production FastAPI server for AI QE Agent

Exposes LLM evaluation, health, and metrics endpoints powered by
Claude claude-sonnet-4-20250514 via the Anthropic SDK.

Run : uvicorn api_server:app --reload --port 8000
Docs: http://localhost:8000/docs

curl examples:
  curl -X POST http://localhost:8000/api/eval/run \
       -H "Content-Type: application/json" \
       -d '{"agent":"ManualTestGenerator","output":"Generated 8 test cases..."}'

  curl http://localhost:8000/api/health
  curl http://localhost:8000/api/metrics
"""

import os
import time
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

import anthropic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("ai-qe-api")

# ── Config ────────────────────────────────────────────────────────────────────
MODEL   = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")
VERSION = "1.0.0"
_start  = time.time()

# ── Anthropic client ──────────────────────────────────────────────────────────
_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# ── In-memory metrics ─────────────────────────────────────────────────────────
_metrics: dict = {
    "total_requests":      0,
    "quality_scores":      [],
    "hallucinations_caught": 0,
    "response_times_ms":   [],
}


def _record(quality: Optional[float], halluc: bool, ms: float) -> None:
    _metrics["total_requests"] += 1
    if quality is not None:
        _metrics["quality_scores"].append(quality)
    if halluc:
        _metrics["hallucinations_caught"] += 1
    _metrics["response_times_ms"].append(ms)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("╔══════════════════════════════════════════════════════════════╗")
    log.info("║   AI QE Agent API Server  v%-34s ║", VERSION)
    log.info("║   Model  : %-48s ║", MODEL)
    log.info("║   Docs   : http://localhost:8000/docs                       ║")
    log.info("╚══════════════════════════════════════════════════════════════╝")
    yield
    log.info("Server shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AI QE Agent API",
    description=(
        "LLM-as-judge evaluation endpoints for the AI QE Agent pipeline — "
        "powered by Claude claude-sonnet-4-20250514. "
        "Evaluates ManualTestGenerator, QAReviewAgent, AutomationScriptGenerator, "
        "and SelfHealingAgent outputs for quality, faithfulness, hallucination, "
        "and chain compatibility."
    ),
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request logger middleware ─────────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.time()
    response = await call_next(request)
    ms = round((time.time() - t0) * 1000, 1)
    log.info(
        "%s %s  →  %s  (%.0fms)",
        request.method, request.url.path, response.status_code, ms,
    )
    return response


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic models
# ═══════════════════════════════════════════════════════════════════════════════

class EvalRequest(BaseModel):
    agent:  str = Field(..., example="ManualTestGenerator")
    output: str = Field(..., example="Generated 8 test cases for login flow...")


class EvalResponse(BaseModel):
    quality_score:        float
    faithfulness:         float
    hallucination_detected: bool
    chain_compatible:     bool


class HealthResponse(BaseModel):
    status:         str
    model:          str
    version:        str
    uptime_seconds: int


class MetricsResponse(BaseModel):
    total_requests:      int
    avg_quality_score:   float
    hallucinations_caught: int
    avg_response_time_ms: float


# ═══════════════════════════════════════════════════════════════════════════════
# Claude helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _claude(system: str, user: str, max_tokens: int = 512) -> str:
    """Single Claude call — returns text content."""
    resp = _client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return resp.content[0].text


def _parse_json(raw: str) -> dict:
    """Extract first JSON object from Claude's response."""
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError("No JSON object found in response")
    return json.loads(raw[start:end])


# ═══════════════════════════════════════════════════════════════════════════════
# 1. POST /api/fraud/detect
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# 1. POST /api/eval/run
# ═══════════════════════════════════════════════════════════════════════════════

EVAL_SYSTEM = """You are an LLM evaluation judge assessing AI QE pipeline agent outputs.
Evaluate the given output and respond ONLY with valid JSON — no prose, no markdown.

JSON schema:
{
  "quality_score": <float 0-1 — overall output quality>,
  "faithfulness": <float 0-1 — 1.0 if instructions followed, 0.0 if not>,
  "hallucination_detected": <bool — true if unsupported claims found>,
  "chain_compatible": <bool — true if output structure is compatible with next agent>
}

Scoring guide:
- quality_score: 0.9+ = excellent, 0.7-0.9 = good, <0.7 = poor
- faithfulness: binary — did the agent follow its given instructions?
- hallucination: flag invented facts, URLs, function names not in context
- chain_compatible: would the next pipeline stage accept this output format?"""


@app.post(
    "/api/eval/run",
    response_model=EvalResponse,
    summary="Run LLM-as-judge evaluation on agent output",
    tags=["Evaluation"],
)
async def eval_run(body: EvalRequest) -> EvalResponse:
    """
    Evaluate an agent's output using Claude as judge.

    **curl example:**
    ```bash
    curl -X POST http://localhost:8000/api/eval/run \\
         -H "Content-Type: application/json" \\
         -d '{"agent": "ManualTestGenerator", "output": "Generated 8 test cases..."}'
    ```
    """
    t0 = time.time()
    try:
        raw  = _claude(
            system=EVAL_SYSTEM,
            user=f"Agent: {body.agent}\n\nOutput to evaluate:\n{body.output[:2000]}",
        )
        data = _parse_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Model response parse error: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    ms     = round((time.time() - t0) * 1000)
    quality = float(data.get("quality_score", 0.8))
    halluc  = bool(data.get("hallucination_detected", False))
    _record(quality, halluc, ms)

    return EvalResponse(
        quality_score         = quality,
        faithfulness          = float(data.get("faithfulness", 1.0)),
        hallucination_detected = halluc,
        chain_compatible      = bool(data.get("chain_compatible", True)),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 2. GET /api/health
# ═══════════════════════════════════════════════════════════════════════════════

@app.get(
    "/api/health",
    response_model=HealthResponse,
    summary="Server health check",
    tags=["System"],
)
async def health() -> HealthResponse:
    """
    Returns server health, model, version, and uptime.

    **curl example:**
    ```bash
    curl http://localhost:8000/api/health
    ```
    """
    return HealthResponse(
        status         = "healthy",
        model          = MODEL,
        version        = VERSION,
        uptime_seconds = int(time.time() - _start),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 3. GET /api/metrics
# ═══════════════════════════════════════════════════════════════════════════════

@app.get(
    "/api/metrics",
    response_model=MetricsResponse,
    summary="In-memory request metrics",
    tags=["System"],
)
async def metrics() -> MetricsResponse:
    """
    Returns aggregated metrics across all requests since server start.

    **curl example:**
    ```bash
    curl http://localhost:8000/api/metrics
    ```
    """
    scores = _metrics["quality_scores"]
    times  = _metrics["response_times_ms"]
    return MetricsResponse(
        total_requests        = _metrics["total_requests"],
        avg_quality_score     = round(sum(scores) / len(scores), 3) if scores else 0.0,
        hallucinations_caught = _metrics["hallucinations_caught"],
        avg_response_time_ms  = round(sum(times) / len(times), 1) if times else 0.0,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Error handlers
# ═══════════════════════════════════════════════════════════════════════════════

@app.exception_handler(422)
async def validation_error_handler(request: Request, exc):
    log.warning("422 Validation error on %s", request.url.path)
    return JSONResponse(
        status_code=422,
        content={"error": "Validation error", "detail": exc.errors()},
    )


@app.exception_handler(500)
async def server_error_handler(request: Request, exc):
    log.error("500 Internal error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Dev entry point
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=True)
