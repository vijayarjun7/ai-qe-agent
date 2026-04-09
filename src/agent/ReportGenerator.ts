import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/Logger';
import { ClaudeClient } from '../utils/ClaudeClient';

export interface TestResult {
  suiteName: string;
  tests: TestCase[];
  duration: number;
  browser?: string;
}

export interface TestCase {
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  duration: number;
  error?: string;
  retries?: number;
  screenshot?: string;
  steps?: string[];
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  passRate: string;
  totalDuration: string;
  generatedAt: string;
}

export class ReportGenerator {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Parse Playwright's JSON report and generate a rich HTML report.
   */
  async generateHTMLReport(
    jsonReportPath: string = 'reports/results.json',
    outputPath: string = 'reports/ai-qe-report.html'
  ): Promise<string> {
    logger.info(`📊 Generating HTML report from ${jsonReportPath}...`);

    let results: TestResult[] = [];

    if (await fs.pathExists(jsonReportPath)) {
      const raw = await fs.readFile(jsonReportPath, 'utf-8');
      const playwrightReport = JSON.parse(raw);
      results = this.parsePlaywrightReport(playwrightReport);
    } else {
      logger.warn(`No JSON report found at ${jsonReportPath} — generating empty report`);
    }

    const summary = this.buildSummary(results);
    const aiInsights = await this.generateAIInsights(results, summary);
    const html = this.buildHTML(results, summary, aiInsights);

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, html, 'utf-8');
    logger.info(`✅ HTML report saved → ${outputPath}`);

    return outputPath;
  }

  /**
   * Generate a quick console-friendly summary.
   */
  printSummary(summary: ReportSummary): void {
    console.log('\n' + '═'.repeat(60));
    console.log('  🤖  AI QE Agent — Test Run Summary');
    console.log('═'.repeat(60));
    console.log(`  Total:    ${summary.total}`);
    console.log(`  ✅ Passed: ${summary.passed}`);
    console.log(`  ❌ Failed: ${summary.failed}`);
    console.log(`  ⏭  Skipped: ${summary.skipped}`);
    console.log(`  🔄 Flaky:  ${summary.flaky}`);
    console.log(`  Pass Rate: ${summary.passRate}`);
    console.log(`  Duration:  ${summary.totalDuration}`);
    console.log('═'.repeat(60) + '\n');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private parsePlaywrightReport(report: any): TestResult[] {
    const suites: TestResult[] = [];
    const processSuite = (suite: any, browser?: string) => {
      if (suite.specs) {
        const tests: TestCase[] = suite.specs.map((spec: any) => {
          const result = spec.tests?.[0]?.results?.[0] || {};
          return {
            title: spec.title,
            status: result.status || 'skipped',
            duration: result.duration || 0,
            error: result.error?.message,
            retries: result.retry || 0,
            steps: result.steps?.map((s: any) => s.title) || [],
          };
        });

        if (tests.length > 0) {
          suites.push({
            suiteName: suite.title || 'Unnamed Suite',
            tests,
            duration: tests.reduce((a: number, t: TestCase) => a + t.duration, 0),
            browser,
          });
        }
      }
      if (suite.suites) {
        for (const child of suite.suites) {
          processSuite(child, browser || suite.title);
        }
      }
    };

    if (report.suites) {
      for (const suite of report.suites) {
        processSuite(suite);
      }
    }
    return suites;
  }

  private buildSummary(results: TestResult[]): ReportSummary {
    const allTests = results.flatMap((r) => r.tests);
    const total = allTests.length;
    const passed = allTests.filter((t) => t.status === 'passed').length;
    const failed = allTests.filter((t) => t.status === 'failed').length;
    const skipped = allTests.filter((t) => t.status === 'skipped').length;
    const flaky = allTests.filter((t) => t.status === 'flaky').length;
    const totalMs = allTests.reduce((a, t) => a + t.duration, 0);

    return {
      total,
      passed,
      failed,
      skipped,
      flaky,
      passRate: total > 0 ? `${Math.round((passed / total) * 100)}%` : 'N/A',
      totalDuration: `${(totalMs / 1000).toFixed(1)}s`,
      generatedAt: new Date().toLocaleString(),
    };
  }

  private async generateAIInsights(results: TestResult[], summary: ReportSummary): Promise<string> {
    try {
      const failedTests = results
        .flatMap((r) => r.tests)
        .filter((t) => t.status === 'failed')
        .map((t) => ({ title: t.title, error: t.error }));

      if (failedTests.length === 0) {
        return '<p>🎉 All tests passed! No failures to analyze.</p>';
      }

      const prompt = `
Analyze these test failures and provide:
1. Root cause categories (group similar failures)
2. Priority fix recommendations
3. Patterns indicating flakiness vs real bugs

Failed tests:
${JSON.stringify(failedTests, null, 2)}

Keep your response concise and actionable. Use HTML with <ul>, <li>, <strong> tags for formatting.
      `.trim();

      return await this.claude.complete(prompt, {
        system: 'You are a senior QA engineer providing test failure analysis. Be concise and actionable.',
        maxTokens: 1024,
      });
    } catch (err) {
      logger.warn('Could not generate AI insights (non-critical)');
      return '<p>AI insights unavailable — check your ANTHROPIC_API_KEY.</p>';
    }
  }

  private buildHTML(results: TestResult[], summary: ReportSummary, aiInsights: string): string {
    const passPercent = summary.total > 0
      ? Math.round((summary.passed / summary.total) * 100)
      : 0;

    const suiteRows = results
      .map((suite) => {
        const rows = suite.tests
          .map((t) => {
            const icon =
              t.status === 'passed' ? '✅' :
              t.status === 'failed' ? '❌' :
              t.status === 'flaky' ? '🔄' : '⏭';
            const errorHtml = t.error
              ? `<div class="error-msg">${escapeHTML(t.error.substring(0, 300))}</div>`
              : '';
            return `
              <tr class="status-${t.status}">
                <td>${icon}</td>
                <td>${escapeHTML(t.title)}</td>
                <td class="status-badge ${t.status}">${t.status}</td>
                <td>${(t.duration / 1000).toFixed(2)}s</td>
                <td>${t.retries || 0}</td>
              </tr>
              ${t.error ? `<tr><td colspan="5">${errorHtml}</td></tr>` : ''}`;
          })
          .join('');

        return `
          <div class="suite-card">
            <h3>📁 ${escapeHTML(suite.suiteName)} ${suite.browser ? `<span class="browser-tag">${suite.browser}</span>` : ''}</h3>
            <table>
              <thead>
                <tr><th></th><th>Test</th><th>Status</th><th>Duration</th><th>Retries</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI QE Agent — Test Report</title>
  <style>
    :root {
      --pass: #22c55e; --fail: #ef4444; --skip: #94a3b8; --flaky: #f59e0b;
      --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; text-align: center; }
    .stat-card .value { font-size: 2.5rem; font-weight: bold; }
    .stat-card .label { font-size: 0.85rem; color: #94a3b8; margin-top: 0.25rem; }
    .stat-card.pass .value { color: var(--pass); }
    .stat-card.fail .value { color: var(--fail); }
    .stat-card.skip .value { color: var(--skip); }
    .stat-card.flaky .value { color: var(--flaky); }
    .progress-bar { background: var(--card); border-radius: 999px; height: 12px; margin-bottom: 2rem; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--pass); border-radius: 999px; width: ${passPercent}%; }
    .section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .section h2 { margin-bottom: 1rem; }
    .suite-card { margin-bottom: 1.5rem; }
    .suite-card h3 { margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
    .browser-tag { font-size: 0.75rem; background: #334155; padding: 2px 8px; border-radius: 999px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); color: #94a3b8; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; vertical-align: top; }
    .status-badge { padding: 2px 8px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .status-badge.passed { background: rgba(34,197,94,0.15); color: var(--pass); }
    .status-badge.failed { background: rgba(239,68,68,0.15); color: var(--fail); }
    .status-badge.skipped { background: rgba(148,163,184,0.15); color: var(--skip); }
    .status-badge.flaky { background: rgba(245,158,11,0.15); color: var(--flaky); }
    .error-msg { background: rgba(239,68,68,0.08); border-left: 3px solid var(--fail); padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 0.8rem; font-family: monospace; color: #fca5a5; margin-top: -4px; }
    .ai-insights { line-height: 1.7; }
    .ai-insights ul { margin-left: 1.5rem; }
    footer { text-align: center; color: #475569; margin-top: 3rem; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>🤖 AI QE Agent Report</h1>
  <p class="subtitle">Generated: ${summary.generatedAt} &nbsp;|&nbsp; Total Duration: ${summary.totalDuration}</p>

  <div class="stats-grid">
    <div class="stat-card"><div class="value">${summary.total}</div><div class="label">Total Tests</div></div>
    <div class="stat-card pass"><div class="value">${summary.passed}</div><div class="label">Passed</div></div>
    <div class="stat-card fail"><div class="value">${summary.failed}</div><div class="label">Failed</div></div>
    <div class="stat-card skip"><div class="value">${summary.skipped}</div><div class="label">Skipped</div></div>
    <div class="stat-card flaky"><div class="value">${summary.flaky}</div><div class="label">Flaky</div></div>
    <div class="stat-card"><div class="value">${summary.passRate}</div><div class="label">Pass Rate</div></div>
  </div>

  <div class="progress-bar"><div class="progress-fill"></div></div>

  ${results.length > 0 ? `
  <div class="section">
    <h2>📋 Test Results</h2>
    ${suiteRows}
  </div>` : '<div class="section"><p>No test results found. Run <code>npm test</code> first.</p></div>'}

  <div class="section">
    <h2>🧠 AI Failure Analysis</h2>
    <div class="ai-insights">${aiInsights}</div>
  </div>

  <footer>
    Powered by AI QE Agent &bull; Playwright + Claude AI &bull; TypeScript
  </footer>
</body>
</html>`;
  }
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
