"""
langsmith_tracer.py — LangSmith tracing layer for AI QE Agent

Wraps the Anthropic client with wrap_anthropic() so every Claude call is
auto-captured, and decorates each agent evaluation function with @traceable
so LangSmith records the full input→LLM→output chain per agent.

Data source : eval_reports/report_*.json  (latest report)
Run         : python langsmith_tracer.py
Traces at   : https://smith.langchain.com
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── LangSmith ─────────────────────────────────────────────────────────────────
from langsmith import traceable, Client
from langsmith.wrappers import wrap_anthropic
import anthropic

# wrap_anthropic() makes every messages.create() call appear as a child span
# inside the @traceable parent trace — no manual instrumentation needed.
_raw_client   = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
claude        = wrap_anthropic(_raw_client)
ls_client     = Client()

MODEL         = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
PROJECT       = os.environ.get("LANGSMITH_PROJECT", "ai-qe-agent-eval")

# ── Data helpers ──────────────────────────────────────────────────────────────

def _load_latest_report() -> dict:
    files = sorted(Path("eval_reports").glob("report_*.json"), key=os.path.getmtime)
    if not files:
        raise FileNotFoundError("No report_*.json found — run: npm run eval")
    path = files[-1]
    print(f"  Loading: {path.name}")
    with open(path) as f:
        return json.load(f)


def _get_entry(report: dict, agent_name: str) -> dict:
    for e in report["evaluations"]:
        if e["agent"] == agent_name:
            return e
    raise KeyError(f"Agent '{agent_name}' not in report")


# ── Shared prompt builder ─────────────────────────────────────────────────────

def _assessment_prompt(entry: dict) -> str:
    """Build a focused assessment prompt from a pre-computed eval entry."""
    qs     = entry["quality_score"]
    halluc = entry["hallucination"]
    faith  = entry["faithfulness"]
    chain  = entry.get("chain_consistency") or {}

    issues = []
    if not faith.get("followed_instructions"):
        missed = faith.get("missed_instructions", [])
        issues.append("Faithfulness FAIL — " + (missed[0][:120] if missed else "unknown"))
    if halluc.get("hallucination_detected"):
        claims = halluc.get("suspicious_claims", [])
        issues.append("Hallucination — " + (claims[0][:120] if claims else "unknown"))
    if chain and not chain.get("compatible"):
        chain_issues = chain.get("issues", [])
        issues.append("Chain break — " + (chain_issues[0][:120] if chain_issues else "unknown"))

    issues_block = "\n".join(f"  • {i}" for i in issues) if issues else "  • None"

    return f"""You are an LLM evaluation analyst reviewing an AI QE pipeline agent.
Write a 2-3 sentence assessment: what the agent did well, its most critical failure, and one concrete fix.

Agent       : {entry['agent']}
Task        : {entry['description'][:280]}

Eval scores :
  Overall quality  : {qs['overall']}
  Completeness     : {qs['completeness']}
  Specificity      : {qs['specificity']}
  Actionability    : {qs['actionability']}
  Hallucination    : {'DETECTED' if halluc['hallucination_detected'] else 'clean'}
  Faithfulness     : {'PASS' if faith['followed_instructions'] else 'FAIL'}

Key issues  :
{issues_block}

Evaluator note: {qs['reasoning'][:200]}

Output 2-3 sentences only. Be specific and actionable."""


def _call_claude(prompt: str) -> str:
    """Single Claude call — auto-traced as a child span via wrap_anthropic."""
    response = claude.messages.create(
        model=MODEL,
        max_tokens=300,
        system="You are a concise LLM evaluation analyst. Output 2-3 sentences only. No bullet points.",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def _build_result(entry: dict, assessment: str) -> dict:
    qs = entry["quality_score"]
    return {
        "agent":                  entry["agent"],
        "assessment":             assessment,
        "scores": {
            "quality_overall":    qs["overall"],
            "completeness":       qs["completeness"],
            "specificity":        qs["specificity"],
            "actionability":      qs["actionability"],
        },
        "hallucination_detected": entry["hallucination"]["hallucination_detected"],
        "followed_instructions":  entry["faithfulness"]["followed_instructions"],
        "chain_compatible":       entry.get("chain_consistency", {}).get("compatible"),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 4 @traceable agent evaluation functions
# Each becomes a top-level trace in LangSmith with the Claude call nested inside.
# ═══════════════════════════════════════════════════════════════════════════════

@traceable(
    name="evaluate_manual_test_generator",
    run_type="chain",
    tags=["ai-qe-agent", "agent-eval", "manual-tests"],
    metadata={"agent": "ManualTestGenerator", "model": MODEL, "pipeline": "ai-qe-agent"},
)
def evaluate_manual_test_generator(entry: dict) -> dict:
    """
    Traces ManualTestGenerator evaluation.
    LangSmith captures: input entry dict → Claude assessment call → scored result.
    """
    prompt     = _assessment_prompt(entry)
    assessment = _call_claude(prompt)
    return _build_result(entry, assessment)


@traceable(
    name="evaluate_qa_review_agent",
    run_type="chain",
    tags=["ai-qe-agent", "agent-eval", "qa-review"],
    metadata={"agent": "QAReviewAgent", "model": MODEL, "pipeline": "ai-qe-agent"},
)
def evaluate_qa_review_agent(entry: dict) -> dict:
    """
    Traces QAReviewAgent evaluation.
    LangSmith captures: input entry dict → Claude assessment call → scored result.
    """
    prompt     = _assessment_prompt(entry)
    assessment = _call_claude(prompt)
    return _build_result(entry, assessment)


@traceable(
    name="evaluate_automation_script_generator",
    run_type="chain",
    tags=["ai-qe-agent", "agent-eval", "automation"],
    metadata={"agent": "AutomationScriptGenerator", "model": MODEL, "pipeline": "ai-qe-agent"},
)
def evaluate_automation_script_generator(entry: dict) -> dict:
    """
    Traces AutomationScriptGenerator evaluation.
    LangSmith captures: input entry dict → Claude assessment call → scored result.
    """
    prompt     = _assessment_prompt(entry)
    assessment = _call_claude(prompt)
    return _build_result(entry, assessment)


@traceable(
    name="evaluate_self_healing_agent",
    run_type="chain",
    tags=["ai-qe-agent", "agent-eval", "self-healing"],
    metadata={"agent": "SelfHealingAgent", "model": MODEL, "pipeline": "ai-qe-agent"},
)
def evaluate_self_healing_agent(entry: dict) -> dict:
    """
    Traces SelfHealingAgent evaluation.
    LangSmith captures: input entry dict → Claude assessment call → scored result.
    """
    prompt     = _assessment_prompt(entry)
    assessment = _call_claude(prompt)
    return _build_result(entry, assessment)


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

EVALUATORS = [
    ("ManualTestGenerator",       evaluate_manual_test_generator),
    ("QAReviewAgent",             evaluate_qa_review_agent),
    ("AutomationScriptGenerator", evaluate_automation_script_generator),
    ("SelfHealingAgent",          evaluate_self_healing_agent),
]


def main() -> None:
    print("\n╔══════════════════════════════════════════════════════════════╗")
    print("║   AI QE AGENT — LangSmith Tracing                           ║")
    print("║   wrap_anthropic()  +  @traceable  •  claude-sonnet-4-6     ║")
    print("╚══════════════════════════════════════════════════════════════╝\n")

    report = _load_latest_report()
    print(f"  Report  : {report['report_id']}")
    print(f"  Snapshot: {report['timestamp'][:19]}")
    print(f"  Project : {PROJECT}\n")

    results = []

    for agent_name, fn in EVALUATORS:
        print(f"  ► Tracing {agent_name}...", end=" ", flush=True)
        entry  = _get_entry(report, agent_name)
        result = fn(entry)
        results.append(result)

        q      = result["scores"]["quality_overall"]
        halluc = "⚠ HALLUC" if result["hallucination_detected"] else "clean"
        faith  = "✓ pass"   if result["followed_instructions"]  else "✗ FAIL"
        chain  = result["chain_compatible"]
        chain_s = ("✓" if chain else "✗ BREAK") if chain is not None else "—"

        print(f"quality={q:.2f}  halluc={halluc}  faith={faith}  chain={chain_s}")
        # Truncate long assessments for console readability
        blurb = result["assessment"]
        print(f"    {blurb[:130]}{'…' if len(blurb) > 130 else ''}\n")

    # ── Summary table ────────────────────────────────────────────────────────
    W = 72
    print("═" * W)
    print(f"  {'Agent':<28} {'Quality':>8} {'Halluc':>9} {'Faithful':>10} {'Chain':>7}")
    print("  " + "─" * (W - 2))
    for r in results:
        s     = r["scores"]
        h     = "⚠ YES" if r["hallucination_detected"]  else "   no"
        f     = "   yes"  if r["followed_instructions"]  else "   NO"
        c_raw = r["chain_compatible"]
        c     = ("  ok" if c_raw else "  ✗") if c_raw is not None else "   —"
        print(f"  {r['agent']:<28} {s['quality_overall']:>8.2f} {h:>9} {f:>10} {c:>7}")

    # ── Trace links ───────────────────────────────────────────────────────────
    print()
    print(f"  View traces at : https://smith.langchain.com")
    print(f"  Project        : {PROJECT}")
    try:
        # Build direct project URL if the client can resolve it
        project_url = f"https://smith.langchain.com/o/default/projects/p/{PROJECT}"
        print(f"  Direct link    : {project_url}")
    except Exception:
        pass
    print("═" * W + "\n")


if __name__ == "__main__":
    main()
