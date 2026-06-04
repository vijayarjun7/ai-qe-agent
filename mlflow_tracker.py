"""
mlflow_tracker.py — MLflow experiment tracking for AI QE Agent

Logs all 4 agent evaluations as separate MLflow runs inside the
"ai-qe-agent-eval" experiment. Each run captures parameters, metrics,
and the eval report JSON as an artifact so every execution is reproducible
and comparable in the MLflow UI.

Data source : eval_reports/report_*.json  (latest report, or hardcoded fallback)
Run         : python mlflow_tracker.py
UI          : mlflow ui  →  http://localhost:5000
"""

import os
import sys
import json
from pathlib import Path
from datetime import date, datetime, timezone
from dotenv import load_dotenv

load_dotenv()

try:
    import mlflow
except ImportError:
    sys.exit("mlflow not installed — run: pip3 install mlflow")

# ── Config ────────────────────────────────────────────────────────────────────
EXPERIMENT = os.environ.get("MLFLOW_EXPERIMENT", "ai-qe-agent-eval")
MODEL      = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")

AGENT_ORDER = [
    "ManualTestGenerator",
    "QAReviewAgent",
    "AutomationScriptGenerator",
    "SelfHealingAgent",
]


# ── Data helpers ──────────────────────────────────────────────────────────────

def _load_latest_report() -> dict | None:
    files = sorted(Path("eval_reports").glob("report_*.json"), key=os.path.getmtime)
    if not files:
        return None
    path = files[-1]
    print(f"  Report  : {path.name}")
    with open(path) as f:
        return json.load(f)


def _get_entry(report: dict, agent_name: str) -> dict:
    for e in report["evaluations"]:
        if e["agent"] == agent_name:
            return e
    raise KeyError(f"Agent '{agent_name}' not in report")


def _build_fallback_data() -> dict:
    """Hardcoded eval values used when no report_*.json exists."""
    return {
        "report_id": "fallback",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "evaluations": [
            {
                "agent": "ManualTestGenerator",
                "description": "Generate manual test cases for a TaskMaster app.",
                "quality_score": {
                    "overall": 0.87, "completeness": 0.82,
                    "specificity": 0.91, "actionability": 0.88,
                    "reasoning": "Hardcoded fallback.",
                },
                "hallucination":   {"hallucination_detected": False, "suspicious_claims": []},
                "faithfulness":    {"followed_instructions": False,  "missed_instructions": []},
                "chain_consistency": {"compatible": False, "issues": []},
            },
            {
                "agent": "QAReviewAgent",
                "description": "Peer-review the ManualTestGenerator output.",
                "quality_score": {
                    "overall": 0.80, "completeness": 0.82,
                    "specificity": 0.78, "actionability": 0.80,
                    "reasoning": "Hardcoded fallback.",
                },
                "hallucination":   {"hallucination_detected": False, "suspicious_claims": []},
                "faithfulness":    {"followed_instructions": True,   "missed_instructions": []},
                "chain_consistency": {"compatible": False, "issues": []},
            },
            {
                "agent": "AutomationScriptGenerator",
                "description": "Convert approved test cases into Playwright scripts.",
                "quality_score": {
                    "overall": 0.94, "completeness": 0.95,
                    "specificity": 0.95, "actionability": 0.92,
                    "reasoning": "Hardcoded fallback.",
                },
                "hallucination":   {"hallucination_detected": True, "suspicious_claims": []},
                "faithfulness":    {"followed_instructions": True,  "missed_instructions": []},
                "chain_consistency": {"compatible": None, "issues": []},
            },
            {
                "agent": "SelfHealingAgent",
                "description": "Detect and repair broken Playwright selectors.",
                "quality_score": {
                    "overall": 1.0, "completeness": 1.0,
                    "specificity": 1.0, "actionability": 1.0,
                    "reasoning": "Hardcoded fallback.",
                },
                "hallucination":   {"hallucination_detected": True, "suspicious_claims": []},
                "faithfulness":    {"followed_instructions": False, "missed_instructions": []},
                "chain_consistency": {"compatible": None, "issues": []},
            },
        ],
        "summary": {},
    }


# ── MLflow run logger ─────────────────────────────────────────────────────────

def _log_agent_run(entry: dict, report: dict, report_path: Path | None) -> dict:
    """
    Open a single MLflow run for one agent, log params/metrics/artifacts,
    and return a summary dict for the comparison table.
    """
    qs     = entry["quality_score"]
    halluc = entry["hallucination"]
    faith  = entry["faithfulness"]
    chain  = entry.get("chain_consistency") or {}

    faith_score = 1.0 if faith.get("followed_instructions") else 0.0
    halluc_score = 1.0 if halluc.get("hallucination_detected") else 0.0

    chain_val = chain.get("compatible")
    if chain_val is True:
        chain_score = 1.0
    elif chain_val is False:
        chain_score = 0.0
    else:
        chain_score = -1.0  # None → not applicable

    with mlflow.start_run(run_name=entry["agent"]) as run:
        # ── Parameters ──────────────────────────────────────────────────────
        mlflow.log_params({
            "agent_name": entry["agent"],
            "model":      MODEL,
            "eval_date":  str(date.today()),
            "run_id":     report.get("report_id", "fallback"),
        })

        # ── Metrics ─────────────────────────────────────────────────────────
        mlflow.log_metrics({
            "quality_score":      qs["overall"],
            "completeness":       qs["completeness"],
            "specificity":        qs["specificity"],
            "actionability":      qs["actionability"],
            "faithfulness":       faith_score,
            "hallucination":      halluc_score,
            "chain_compatibility": chain_score,
            "latency_seconds":    0.0,   # not captured in eval JSON
        })

        # ── Tags ────────────────────────────────────────────────────────────
        mlflow.set_tags({"pipeline": "ai-qe-agent", "agent": entry["agent"]})

        # ── Artifact — eval report JSON ──────────────────────────────────────
        if report_path and report_path.exists():
            mlflow.log_artifact(str(report_path), artifact_path="eval_reports")

        mlflow_run_id = run.info.run_id

    return {
        "agent":                entry["agent"],
        "mlflow_run_id":        mlflow_run_id,
        "quality_score":        qs["overall"],
        "faithfulness":         faith_score,
        "hallucination":        halluc.get("hallucination_detected", False),
        "chain_compatibility":  chain_val,
    }


# ── Summary artifact ──────────────────────────────────────────────────────────

def _write_summary(results: list[dict], report: dict) -> Path:
    lines = [
        "AI QE AGENT — MLflow Eval Summary",
        f"Report    : {report.get('report_id', 'fallback')}",
        f"Timestamp : {report.get('timestamp', '')[:19]}",
        f"Model     : {MODEL}",
        f"Generated : {datetime.now(timezone.utc).isoformat()[:19]}Z",
        "",
        f"{'Agent':<28} {'Quality':>8} {'Faith':>7} {'Halluc':>8} {'Chain':>7}",
        "─" * 62,
    ]
    for r in results:
        h = "YES" if r["hallucination"] else "no"
        f = "pass" if r["faithfulness"] == 1.0 else "FAIL"
        c_raw = r["chain_compatibility"]
        c = "ok" if c_raw is True else ("BREAK" if c_raw is False else "N/A")
        lines.append(
            f"  {r['agent']:<26} {r['quality_score']:>8.2f} {f:>7} {h:>8} {c:>7}"
        )

    best   = max(results, key=lambda r: r["quality_score"])
    worst  = min(results, key=lambda r: r["faithfulness"])
    total_halluc = sum(1 for r in results if r["hallucination"])
    avg_q  = sum(r["quality_score"] for r in results) / len(results)

    lines += [
        "",
        "Comparison",
        "─" * 62,
        f"  Best quality    : {best['agent']} ({best['quality_score']:.2f})",
        f"  Worst faithful  : {worst['agent']} ({worst['faithfulness']:.1f})",
        f"  Hallucinations  : {total_halluc} / {len(results)}",
        f"  Avg quality     : {avg_q:.3f}",
    ]

    out = Path("mlflow_summary.txt")
    out.write_text("\n".join(lines))
    return out


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("\n╔══════════════════════════════════════════════════════════════╗")
    print("║   AI QE AGENT — MLflow Experiment Tracker                   ║")
    print("║   4 agents  •  params + metrics + artifacts  •  local UI    ║")
    print("╚══════════════════════════════════════════════════════════════╝\n")

    # ── Experiment ────────────────────────────────────────────────────────────
    mlflow.set_experiment(EXPERIMENT)
    print(f"  Experiment : {EXPERIMENT}")

    # ── Load report ───────────────────────────────────────────────────────────
    report_path: Path | None = None
    report = _load_latest_report()

    if report is None:
        print("  [WARN] No eval report found — using hardcoded fallback values.")
        report = _build_fallback_data()
    else:
        files = sorted(Path("eval_reports").glob("report_*.json"), key=os.path.getmtime)
        report_path = files[-1]
        print(f"  Report ID  : {report.get('report_id', '—')}")
        print(f"  Snapshot   : {report.get('timestamp', '')[:19]}")

    print()

    # ── Log each agent ────────────────────────────────────────────────────────
    results = []
    for agent_name in AGENT_ORDER:
        print(f"  ► Logging {agent_name}...", end=" ", flush=True)
        try:
            entry  = _get_entry(report, agent_name)
            result = _log_agent_run(entry, report, report_path)
            results.append(result)

            q      = result["quality_score"]
            halluc = "⚠ HALLUC" if result["hallucination"] else "clean"
            faith  = "✓ pass"   if result["faithfulness"] == 1.0 else "✗ FAIL"
            c_raw  = result["chain_compatibility"]
            chain  = ("✓" if c_raw else "✗ BREAK") if c_raw is not None else "N/A"
            print(f"quality={q:.2f}  halluc={halluc}  faith={faith}  chain={chain}")

        except Exception as exc:
            print(f"[ERROR] {exc}")

    if not results:
        sys.exit("\n[FATAL] No agents were logged successfully.")

    # ── Write & log summary artifact ──────────────────────────────────────────
    summary_path = _write_summary(results, report)
    # Attach the summary to the last run so it appears in the UI
    last_run_id = results[-1]["mlflow_run_id"]
    with mlflow.start_run(run_id=last_run_id):
        mlflow.log_artifact(str(summary_path), artifact_path="summary")
    print(f"\n  Summary saved → {summary_path}")

    # ── Comparison table ──────────────────────────────────────────────────────
    W = 72
    print()
    print("═" * W)
    print(f"  {'Agent':<28} {'Quality':>8} {'Halluc':>9} {'Faithful':>10} {'Chain':>7}")
    print("  " + "─" * (W - 2))
    for r in results:
        h     = "⚠ YES" if r["hallucination"]       else "   no"
        f     = "   yes" if r["faithfulness"] == 1.0 else "   NO"
        c_raw = r["chain_compatibility"]
        c     = ("  ok" if c_raw else "  ✗") if c_raw is not None else "  N/A"
        print(f"  {r['agent']:<28} {r['quality_score']:>8.2f} {h:>9} {f:>10} {c:>7}")

    best         = max(results, key=lambda r: r["quality_score"])
    worst        = min(results, key=lambda r: r["faithfulness"])
    total_halluc = sum(1 for r in results if r["hallucination"])
    avg_q        = sum(r["quality_score"] for r in results) / len(results)

    print()
    print(f"  Best agent by quality   : {best['agent']} ({best['quality_score']:.2f})")
    print(f"  Worst agent faithfulness: {worst['agent']} ({worst['faithfulness']:.1f})")
    print(f"  Total hallucinations    : {total_halluc} / {len(results)}")
    print(f"  Avg quality             : {avg_q:.3f}")

    print()
    print("  ─" * (W // 2))
    print(f"  MLflow UI : http://localhost:5000")
    print(f"  Run with  : mlflow ui")
    print("═" * W + "\n")


if __name__ == "__main__":
    main()
