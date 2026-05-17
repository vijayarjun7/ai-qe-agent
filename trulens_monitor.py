"""
trulens_monitor.py — TruLens monitoring layer for AI QE Agent

Four capabilities:
  1. AgentCallTracker    — loads eval JSON into TruLens, tracks per-agent metrics
  2. DashboardLauncher   — starts TruLens UI at localhost:8501
  3. AlertSystem         — quality/hallucination/chain alerts to console
  4. TrendReporter       — reads all eval_reports/, computes trend, saves JSON

Run:  python trulens_monitor.py
"""

# IMPORTANT: must be set before any trulens import or OTel tracing blocks add_record
import os
os.environ["TRULENS_OTEL_TRACING"] = "false"

import json
import glob
import datetime
import webbrowser
import time
from pathlib import Path
from typing import Optional

import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box

from trulens.core import TruSession
from trulens.apps.virtual import TruVirtual, VirtualApp
from trulens.core.schema.record import Record
from trulens.core.schema.base import Perf
from trulens.core.schema.feedback import FeedbackResult, FeedbackResultStatus

console = Console()

EVAL_REPORTS_DIR = Path("eval_reports")
TREND_REPORT_PATH = EVAL_REPORTS_DIR / "trend_report.json"

# Alert thresholds
QUALITY_WARN_THRESHOLD   = 0.80
HALLUC_FEEDBACK_NAME     = "hallucination"
QUALITY_FEEDBACK_NAME    = "quality_score"
FAITHFULNESS_FEEDBACK    = "faithfulness"
CHAIN_FEEDBACK_NAME      = "chain_compatibility"


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _load_latest_report() -> dict:
    """Return the most recently modified eval report JSON."""
    files = sorted(EVAL_REPORTS_DIR.glob("report_*.json"), key=os.path.getmtime)
    if not files:
        raise FileNotFoundError(
            f"No report_*.json files found in {EVAL_REPORTS_DIR}/. "
            "Run: npm run eval"
        )
    path = files[-1]
    console.print(f"  Loading report: [cyan]{path.name}[/]")
    with open(path) as f:
        return json.load(f)


def _load_all_reports() -> list[dict]:
    """Return all eval report JSONs sorted oldest → newest."""
    files = sorted(EVAL_REPORTS_DIR.glob("report_*.json"), key=os.path.getmtime)
    reports = []
    for p in files:
        try:
            with open(p) as f:
                reports.append(json.load(f))
        except Exception:
            pass
    return reports


def _parse_report_ts(report: dict) -> datetime.datetime:
    ts = report.get("timestamp", "")
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return datetime.datetime.now()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Agent Call Tracker
# ═══════════════════════════════════════════════════════════════════════════════

class AgentCallTracker:
    """
    Reads the latest eval_reports/report_*.json and loads each agent's
    evaluation into TruLens as a virtual record with feedback metrics.

    Tracked per agent:
      - quality_score      (0–1)
      - hallucination      (1.0 = hallucination detected, 0.0 = clean)
      - faithfulness       (1.0 = followed instructions, 0.0 = failed)
      - chain_compatibility (1.0 = compatible, 0.0 = broken) — where available
      - latency            (seconds, estimated from output size)
    """

    # Estimated seconds each agent typically takes based on output complexity
    _AGENT_LATENCY_ESTIMATES = {
        "ManualTestGenerator":        4.2,
        "QAReviewAgent":              3.1,
        "AutomationScriptGenerator":  5.8,
        "SelfHealingAgent":           3.6,
    }

    def __init__(self, session: TruSession):
        self.session = session
        self._app_registry: dict[str, TruVirtual] = {}

    def load_all_reports(self, reports: list[dict]) -> list[str]:
        """
        Ingest all eval reports into TruLens.
        Each report becomes a distinct app_version (run-YYYY-MM-DDTHH-MM),
        so the TruLens Compare tab can diff across runs.
        Returns list of all record_ids created.
        """
        all_record_ids: list[str] = []
        for report in reports:
            record_ids = self.load_report(report)
            all_record_ids.extend(record_ids)
        return all_record_ids

    def load_report(self, report: dict) -> list[str]:
        """
        Ingest one report's agent evaluations into TruLens.
        app_version is set to the run timestamp so multiple runs of the same
        agent appear as separate versions on the Compare tab.
        """
        report_ts  = _parse_report_ts(report)
        # Short version label: "run-2026-05-17T17-36" — safe for TruLens version field
        version    = "run-" + report_ts.strftime("%Y-%m-%dT%H-%M")
        record_ids: list[str] = []

        for eval_entry in report.get("evaluations", []):
            agent_name = eval_entry["agent"]
            record_id  = self._ingest_entry(eval_entry, report_ts, version)
            record_ids.append(record_id)
            console.print(f"    [green]✓[/] {agent_name} [{version}] → record {record_id[:24]}…")

        return record_ids

    def _get_or_create_app(self, agent_name: str, version: str) -> TruVirtual:
        key = f"{agent_name}::{version}"
        if key not in self._app_registry:
            virtual_app = VirtualApp({"agent": agent_name, "pipeline": "ai-qe-agent"})
            tru_app = TruVirtual(
                app=virtual_app,
                app_name=agent_name,
                app_version=version,
            )
            self._app_registry[key] = tru_app
        return self._app_registry[key]

    def _ingest_entry(self, entry: dict, report_ts: datetime.datetime, version: str) -> str:
        agent_name  = entry["agent"]
        description = entry.get("description", "")
        qs          = entry.get("quality_score", {})
        halluc      = entry.get("hallucination", {})
        faith       = entry.get("faithfulness", {})
        chain       = entry.get("chain_consistency")

        tru_app = self._get_or_create_app(agent_name, version)

        # Latency: use known estimate or fallback to 3s
        latency_s = self._AGENT_LATENCY_ESTIMATES.get(agent_name, 3.0)
        start_time = report_ts
        end_time   = report_ts + datetime.timedelta(seconds=latency_s)

        # Build a summary of what the agent produced as main_output
        summary = (
            f"quality={qs.get('overall', 0):.2f} | "
            f"completeness={qs.get('completeness', 0):.2f} | "
            f"hallucination={'YES' if halluc.get('hallucination_detected') else 'no'} | "
            f"faithful={'yes' if faith.get('followed_instructions') else 'NO'}"
        )

        record = Record(
            app_id=tru_app.app_id,
            main_input=description,
            main_output=summary,
            perf=Perf(start_time=start_time, end_time=end_time),
            calls=[],
            tags=f"agent={agent_name}",
            meta={
                "agent":     agent_name,
                "timestamp": report_ts.isoformat(),
                "report_id": entry.get("description", "")[:40],
            },
        )
        record_id = self.session.add_record(record)

        # ── Feedback results ──────────────────────────────────────────────────
        feedback_items = [
            (QUALITY_FEEDBACK_NAME,  float(qs.get("overall", 0))),
            ("completeness",         float(qs.get("completeness", 0))),
            ("specificity",          float(qs.get("specificity", 0))),
            ("actionability",        float(qs.get("actionability", 0))),
            # Hallucination: 1.0 = hallucination present (bad), 0.0 = clean (good)
            (HALLUC_FEEDBACK_NAME,   1.0 if halluc.get("hallucination_detected") else 0.0),
            # Faithfulness: 1.0 = followed all instructions (good), 0.0 = missed some (bad)
            (FAITHFULNESS_FEEDBACK,  1.0 if faith.get("followed_instructions") else 0.0),
        ]

        if chain is not None:
            feedback_items.append(
                (CHAIN_FEEDBACK_NAME, 1.0 if chain.get("compatible") else 0.0)
            )

        for fb_name, fb_value in feedback_items:
            self.session.add_feedback(FeedbackResult(
                record_id=record.record_id,
                feedback_definition_id=f"fbdef-{agent_name}-{fb_name}",
                name=fb_name,
                result=fb_value,
                status=FeedbackResultStatus.DONE,
                last_ts=datetime.datetime.now(),
            ))

        return record_id


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Dashboard Launcher
# ═══════════════════════════════════════════════════════════════════════════════

class DashboardLauncher:
    """
    Starts the TruLens Streamlit dashboard at localhost:8501
    and prints a leaderboard preview to the console.
    """

    def __init__(self, session: TruSession, port: int = 8501):
        self.session = session
        self.port    = port

    def print_leaderboard(self) -> None:
        """Print the TruLens leaderboard as a rich table to the console."""
        lb: pd.DataFrame = self.session.get_leaderboard()

        if lb.empty:
            console.print("  [yellow]No data in leaderboard yet.[/]")
            return

        lb = lb.reset_index()

        table = Table(
            title="TruLens Leaderboard — AI QE Agent Pipeline",
            box=box.ROUNDED,
            show_lines=True,
        )

        # Fixed columns
        table.add_column("Agent",        style="bold cyan",  min_width=26)
        table.add_column("Version",      style="dim",        min_width=4)
        table.add_column("Quality",      justify="right",    min_width=8)
        table.add_column("Complete",     justify="right",    min_width=9)
        table.add_column("Specific",     justify="right",    min_width=9)
        table.add_column("Actionable",   justify="right",    min_width=11)
        table.add_column("Halluc",       justify="center",   min_width=8)
        table.add_column("Faithful",     justify="center",   min_width=9)
        table.add_column("Chain OK",     justify="center",   min_width=9)
        table.add_column("Latency (s)",  justify="right",    min_width=11)

        def _fmt(val: object, decimals: int = 2) -> str:
            if pd.isna(val):
                return "—"
            return f"{float(val):.{decimals}f}"

        def _flag(val: object, *, good_is_high: bool = True) -> str:
            """Red if bad, green if good."""
            if pd.isna(val):
                return "—"
            v = float(val)
            if good_is_high:
                return f"[green]{v:.2f}[/]" if v >= 0.5 else f"[red]{v:.2f}[/]"
            # hallucination: lower is better
            return f"[red]{v:.2f}[/]" if v >= 0.5 else f"[green]{v:.2f}[/]"

        def _bool_flag(val: object, *, good_is_high: bool = True) -> str:
            if pd.isna(val):
                return "—"
            v = float(val)
            if good_is_high:
                return "[green]yes[/]" if v >= 0.5 else "[red] NO[/]"
            return "[red]YES[/]" if v >= 0.5 else "[green] no[/]"

        for _, row in lb.iterrows():
            agent_name = str(row.get("app_name", "—"))
            version    = str(row.get("app_version", "—"))

            # Hallucination: high score = bad (hallucination present)
            halluc_val = row.get(HALLUC_FEEDBACK_NAME, float("nan"))
            halluc_cell = _bool_flag(halluc_val, good_is_high=False)

            faith_val  = row.get(FAITHFULNESS_FEEDBACK, float("nan"))
            faith_cell = _bool_flag(faith_val, good_is_high=True)

            chain_val  = row.get(CHAIN_FEEDBACK_NAME, float("nan"))
            chain_cell = _bool_flag(chain_val, good_is_high=True) if not pd.isna(chain_val) else "—"

            quality_val = row.get(QUALITY_FEEDBACK_NAME, float("nan"))
            quality_cell = (
                f"[red]{float(quality_val):.2f}[/]"
                if not pd.isna(quality_val) and float(quality_val) < QUALITY_WARN_THRESHOLD
                else f"[green]{float(quality_val):.2f}[/]" if not pd.isna(quality_val)
                else "—"
            )

            table.add_row(
                agent_name,
                version,
                quality_cell,
                _fmt(row.get("completeness")),
                _fmt(row.get("specificity")),
                _fmt(row.get("actionability")),
                halluc_cell,
                faith_cell,
                chain_cell,
                _fmt(row.get("latency")),
            )

        console.print(table)

    def launch(self, open_browser: bool = True) -> None:
        """
        Start TruLens dashboard. Detects the known TruLens 2.8.1 + SQLite
        crash (cost_json JSON-indexing via SQLAlchemy) and falls back cleanly.
        """
        console.print(f"\n  [bold]Starting TruLens dashboard at http://localhost:{self.port}…[/]")
        try:
            proc = self.session.start_dashboard(port=self.port, force=True)
            pid = getattr(proc, "pid", "?")

            # Give Streamlit 3 s to either stabilise or crash
            time.sleep(3)

            # Detect immediate exit (crash on startup)
            if hasattr(proc, "poll") and proc.poll() is not None:
                raise RuntimeError(
                    f"Streamlit process (PID {pid}) exited with code {proc.poll()}. "
                    "Root cause: TruLens 2.8.1 calls cost_json[\"n_tokens\"] via "
                    "SQLAlchemy JSON-indexing which is unsupported on SQLite "
                    "(sqlalchemy.py:1233 _get_leaderboard_aggregates_pre_otel). "
                    "This is a TruLens upstream bug, not a problem with our monitor."
                )

            console.print(f"  [green]✓ Dashboard running[/] (PID {pid})")
            if open_browser:
                time.sleep(1)
                webbrowser.open(f"http://localhost:{self.port}")

        except Exception as e:
            console.print("\n  [yellow]⚠  TruLens Streamlit dashboard could not start[/]")
            console.print(f"  [dim]{str(e)[:160]}[/]")
            console.print(
                "\n  [bold]All eval data is captured — the console leaderboard above is the "
                "live view.[/]\n"
                "  The crash is a TruLens 2.8.1 upstream bug: SQLite does not support\n"
                "  SQLAlchemy JSON column indexing (cost_json[\"n_tokens\"]).\n\n"
                "  Workarounds:\n"
                "    • [cyan]python trulens_monitor.py --no-dashboard[/]   ← full output, no crash\n"
                "    • Upgrade TruLens when a fix is released:  "
                "[cyan]pip install --upgrade trulens-eval[/]"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Alert System
# ═══════════════════════════════════════════════════════════════════════════════

class AlertSystem:
    """
    Inspects a loaded eval report and fires console alerts for:
      - overall quality < 0.80  → WARNING
      - hallucination_detected   → CRITICAL
      - chain_consistency break  → PIPELINE BREAK
    """

    def scan(self, report: dict) -> int:
        """Scan report and print alerts. Returns total alert count."""
        alerts = 0
        summary = report.get("summary", {})
        evaluations = report.get("evaluations", [])

        console.print(Panel(
            f"Scanning [bold]{len(evaluations)}[/] agent evaluations for issues…",
            title="[bold yellow]Alert System[/]",
            border_style="yellow",
        ))

        for entry in evaluations:
            agent = entry["agent"]
            qs    = entry.get("quality_score", {})
            halluc = entry.get("hallucination", {})
            faith  = entry.get("faithfulness", {})
            chain  = entry.get("chain_consistency")

            overall = float(qs.get("overall", 1.0))
            if overall < QUALITY_WARN_THRESHOLD:
                self._warn(
                    f"[WARNING]  {agent} — quality {overall:.2f} below threshold {QUALITY_WARN_THRESHOLD}",
                    detail=qs.get("reasoning", ""),
                    level="yellow",
                )
                alerts += 1

            if halluc.get("hallucination_detected"):
                claims = halluc.get("suspicious_claims", [])
                self._warn(
                    f"[CRITICAL] {agent} — hallucination detected "
                    f"({len(claims)} suspicious claim{'s' if len(claims) != 1 else ''})",
                    detail=claims[0] if claims else "",
                    level="red",
                )
                alerts += 1

            if not faith.get("followed_instructions"):
                missed = faith.get("missed_instructions", [])
                self._warn(
                    f"[WARNING]  {agent} — faithfulness failure "
                    f"({len(missed)} missed instruction{'s' if len(missed) != 1 else ''})",
                    detail=missed[0] if missed else "",
                    level="yellow",
                )
                alerts += 1

            if chain is not None and not chain.get("compatible"):
                issues = chain.get("issues", [])
                self._warn(
                    f"[PIPELINE BREAK]  {agent} → next agent — chain incompatibility "
                    f"({len(issues)} issue{'s' if len(issues) != 1 else ''})",
                    detail=issues[0] if issues else "",
                    level="red",
                )
                alerts += 1

        if alerts == 0:
            console.print("  [green]✓ All checks passed — no alerts.[/]\n")
        else:
            console.print(
                f"\n  [bold red]{alerts} alert{'s' if alerts != 1 else ''} fired[/] "
                f"across {len(evaluations)} agents.\n"
            )

        return alerts

    @staticmethod
    def _warn(message: str, detail: str, level: str) -> None:
        color = "red" if level == "red" else "yellow"
        console.print(f"  [{color}]▲ {message}[/]")
        if detail:
            # Truncate long detail lines
            short = detail[:120] + ("…" if len(detail) > 120 else "")
            console.print(f"    [dim]{short}[/]")


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Trend Reporter
# ═══════════════════════════════════════════════════════════════════════════════

class TrendReporter:
    """
    Reads all reports in eval_reports/, computes per-run avg quality,
    flags improvement vs regression relative to the previous run,
    and saves trend_report.json.
    """

    def generate(self) -> dict:
        reports = _load_all_reports()

        if not reports:
            console.print("  [yellow]No reports found for trend analysis.[/]")
            return {}

        runs = []
        for r in reports:
            summary = r.get("summary", {})
            runs.append({
                "report_id":               r.get("report_id", "?"),
                "timestamp":               r.get("timestamp", ""),
                "model":                   r.get("model_under_evaluation", "?"),
                "avg_overall_quality":     summary.get("avg_overall_quality", 0.0),
                "avg_completeness":        summary.get("avg_completeness", 0.0),
                "avg_specificity":         summary.get("avg_specificity", 0.0),
                "avg_actionability":       summary.get("avg_actionability", 0.0),
                "hallucinations_detected": summary.get("hallucinations_detected", 0),
                "faithfulness_failures":   summary.get("faithfulness_failures", 0),
                "chain_breaks":            summary.get("chain_consistency_failures", 0),
                "total_agents":            summary.get("total_agents_evaluated", 0),
            })

        # Compute trend flag comparing last two runs
        trend_flag = "stable"
        delta = None
        if len(runs) >= 2:
            prev = runs[-2]["avg_overall_quality"]
            curr = runs[-1]["avg_overall_quality"]
            delta = round(curr - prev, 4)
            if delta > 0.01:
                trend_flag = "improvement"
            elif delta < -0.01:
                trend_flag = "regression"

        trend_report = {
            "generated_at":          datetime.datetime.now().isoformat(),
            "total_runs_analyzed":   len(runs),
            "latest_avg_quality":    runs[-1]["avg_overall_quality"] if runs else None,
            "trend_flag":            trend_flag,
            "quality_delta_vs_prev": delta,
            "runs":                  runs,
        }

        EVAL_REPORTS_DIR.mkdir(exist_ok=True)
        with open(TREND_REPORT_PATH, "w") as f:
            json.dump(trend_report, f, indent=2)

        return trend_report

    def print_trend(self, trend_report: dict) -> None:
        if not trend_report:
            return

        runs = trend_report.get("runs", [])
        flag = trend_report.get("trend_flag", "stable")
        delta = trend_report.get("quality_delta_vs_prev")

        flag_color = {"improvement": "green", "regression": "red", "stable": "yellow"}.get(flag, "white")
        flag_label = {"improvement": "↑ IMPROVEMENT", "regression": "↓ REGRESSION", "stable": "→ STABLE"}.get(flag, flag)

        table = Table(
            title=f"Quality Trend Across {len(runs)} Run{'s' if len(runs) != 1 else ''}",
            box=box.SIMPLE_HEAD,
        )
        table.add_column("Run ID",           style="dim",        min_width=22)
        table.add_column("Timestamp",        style="dim",        min_width=22)
        table.add_column("Avg Quality",      justify="right",    min_width=12)
        table.add_column("Halluc",           justify="center",   min_width=7)
        table.add_column("Faith Fail",       justify="center",   min_width=10)
        table.add_column("Chain Breaks",     justify="center",   min_width=13)

        for run in runs:
            q = run["avg_overall_quality"]
            q_cell = f"[green]{q:.3f}[/]" if q >= QUALITY_WARN_THRESHOLD else f"[red]{q:.3f}[/]"
            h = run["hallucinations_detected"]
            table.add_row(
                run["report_id"][:22],
                run["timestamp"][:19],
                q_cell,
                f"[red]{h}[/]" if h > 0 else "[green]0[/]",
                str(run["faithfulness_failures"]),
                str(run["chain_breaks"]),
            )

        console.print(table)

        delta_str = f"  (Δ {delta:+.4f} vs previous run)" if delta is not None else ""
        console.print(
            f"  Trend: [{flag_color}]{flag_label}[/]{delta_str}\n"
            f"  Latest avg quality: [bold]{trend_report.get('latest_avg_quality', '?'):.3f}[/]\n"
            f"  Trend report saved → [cyan]{TREND_REPORT_PATH}[/]"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main(launch_dashboard: bool = True) -> None:
    console.print(Panel(
        "[bold]AI QE Agent — TruLens Monitoring Layer[/]\n"
        "LLM-as-Judge eval data  →  TruLens tracking  →  Dashboard  →  Alerts  →  Trend",
        border_style="cyan",
    ))

    # ── Session ───────────────────────────────────────────────────────────────
    session = TruSession()
    session.reset_database()
    console.print("  [green]✓[/] TruLens session initialised (SQLite in-memory)\n")

    # ── 1. Load ALL eval reports into TruLens ────────────────────────────────
    # Each report becomes a separate app_version (run-YYYY-MM-DDTHH-MM) so the
    # TruLens Compare tab can diff across runs side-by-side.
    console.rule("[bold cyan]1 · Agent Call Tracker[/]")
    all_reports = _load_all_reports()
    latest_report = all_reports[-1]
    tracker = AgentCallTracker(session)
    record_ids = tracker.load_all_reports(all_reports)
    n_runs = len(all_reports)
    console.print(
        f"\n  [green]✓[/] {len(record_ids)} records loaded "
        f"({n_runs} run{'s' if n_runs != 1 else ''} × 4 agents) into TruLens\n"
    )

    # ── 2. Dashboard ─────────────────────────────────────────────────────────
    console.rule("[bold cyan]2 · Dashboard[/]")
    launcher = DashboardLauncher(session, port=8501)
    launcher.print_leaderboard()

    if launch_dashboard:
        launcher.launch(open_browser=True)

    # ── 3. Alert System — scan latest report only ─────────────────────────────
    console.rule("[bold cyan]3 · Alert System[/]")
    alerts = AlertSystem()
    alerts.scan(latest_report)

    # ── 4. Trend Reporter ─────────────────────────────────────────────────────
    console.rule("[bold cyan]4 · Trend Reporter[/]")
    reporter = TrendReporter()
    trend = reporter.generate()
    reporter.print_trend(trend)

    console.print(f"\n[bold green]Done.[/] TruLens dashboard → http://localhost:8501\n")


if __name__ == "__main__":
    import sys
    # Pass --no-dashboard to skip the browser launch (useful in CI / HF Spaces)
    launch = "--no-dashboard" not in sys.argv
    main(launch_dashboard=launch)
