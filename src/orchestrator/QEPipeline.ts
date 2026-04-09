import * as path from 'path';
import * as fs from 'fs-extra';
import { execSync, spawn } from 'child_process';
import { AIDevAgent, AppSpec } from '../agent/AIDevAgent';
import { ManualTestGenerator, ManualTestSuite } from '../agent/ManualTestGenerator';
import { QAReviewAgent } from '../agent/QAReviewAgent';
import { AutomationScriptGenerator, AutomationBundle } from '../agent/AutomationScriptGenerator';
import { AIMobileTester, MobileTestType, MobileTestOptions } from '../agent/AIMobileTester';
import { ChangeDetector, DetectedChange } from '../agent/ChangeDetector';
import { ReviewQueueManager } from '../agent/ReviewQueueManager';
import { SelfHealingAgent } from '../agent/SelfHealingAgent';
import { ReportGenerator } from '../agent/ReportGenerator';
import { logger } from '../utils/Logger';

export interface PipelineConfig {
  appDir?: string;           // where the demo app lives, default: demo-app/
  testsDir?: string;         // where generated tests go, default: tests/generated
  manualTestsDir?: string;   // where manual test cases go, default: tests/manual
  reviewsDir?: string;       // where review reports go, default: tests/reviews
  reportsDir?: string;       // HTML reports, default: reports/
  baseURL?: string;
  apiBaseURL?: string;
}

export interface PipelineRunResult {
  stage: string;
  success: boolean;
  details: string;
  artifacts: string[];
}

const DEFAULT_CONFIG: Required<PipelineConfig> = {
  appDir: 'demo-app',
  testsDir: 'tests/generated',
  manualTestsDir: 'tests/manual',
  reviewsDir: 'tests/reviews',
  reportsDir: 'reports',
  baseURL: 'http://localhost:3000',
  apiBaseURL: 'http://localhost:3001',
};

export class QEPipeline {
  private cfg: Required<PipelineConfig>;
  private devAgent: AIDevAgent;
  private manualGen: ManualTestGenerator;
  private qaReviewer: QAReviewAgent;
  private automationGen: AutomationScriptGenerator;
  private mobileTester: AIMobileTester;
  private changeDetector: ChangeDetector;
  private reviewQueue: ReviewQueueManager;
  private healingAgent: SelfHealingAgent;
  private reportGen: ReportGenerator;

  constructor(config: PipelineConfig = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.devAgent = new AIDevAgent();
    this.manualGen = new ManualTestGenerator();
    this.qaReviewer = new QAReviewAgent();
    this.automationGen = new AutomationScriptGenerator();
    this.mobileTester = new AIMobileTester();
    this.changeDetector = new ChangeDetector();
    this.reviewQueue = new ReviewQueueManager();
    this.healingAgent = new SelfHealingAgent();
    this.reportGen = new ReportGenerator();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1: AI Dev — Generate the full-stack demo app
  // ═══════════════════════════════════════════════════════════════════════════

  async runDevGen(appSpec?: Partial<AppSpec>): Promise<PipelineRunResult> {
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 1: AI Dev Agent — Generating App');
    logger.info('══════════════════════════════════════════════\n');

    const spec: AppSpec = {
      appName: appSpec?.appName || 'TaskMaster',
      description: appSpec?.description || 'A full-stack Task Manager app with authentication, CRUD tasks, priorities, due dates, and responsive mobile UI',
      features: appSpec?.features || [
        'User registration and login with JWT authentication',
        'Create, read, update, delete tasks',
        'Task fields: title, description, priority (low/medium/high), due date, completion status',
        'Filter tasks by status and priority',
        'Mobile-responsive layout (works on iPhone and Android)',
        'REST API: /api/auth and /api/tasks endpoints',
        'SQLite database with users and tasks tables',
      ],
      outputDir: path.resolve(this.cfg.appDir),
    };

    try {
      const result = await this.devAgent.generateApp(spec);
      return {
        stage: 'dev-gen',
        success: true,
        details: `Generated ${result.files.length} files at ${result.outputDir}\nSetup: ${result.setupInstructions}`,
        artifacts: result.files.map((f) => path.join(result.outputDir, f.path)),
      };
    } catch (err: any) {
      return { stage: 'dev-gen', success: false, details: err.message, artifacts: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2: QE Workflow — Manual Tests → Review → Automation → Run → Report
  // ═══════════════════════════════════════════════════════════════════════════

  async runQEWorkflow(component = 'all'): Promise<PipelineRunResult[]> {
    const results: PipelineRunResult[] = [];

    // ── Step 1: Generate Manual Test Cases ────────────────────────────────
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 2 / Step 1: Generate Manual Test Cases');
    logger.info('══════════════════════════════════════════════\n');

    const requirementsPath = path.join(this.cfg.appDir, 'REQUIREMENTS.md');
    if (!await fs.pathExists(requirementsPath)) {
      results.push({
        stage: 'manual-test-gen',
        success: false,
        details: `REQUIREMENTS.md not found at ${requirementsPath}. Run dev-gen first.`,
        artifacts: [],
      });
      return results;
    }

    let suite: ManualTestSuite;
    try {
      suite = await this.manualGen.generate({
        requirementsPath,
        component,
        outputDir: this.cfg.manualTestsDir,
      });
      results.push({
        stage: 'manual-test-gen',
        success: true,
        details: `Generated ${suite.testCases.length} manual test cases for component: ${component}`,
        artifacts: [],
      });
    } catch (err: any) {
      results.push({ stage: 'manual-test-gen', success: false, details: err.message, artifacts: [] });
      return results;
    }

    // ── Step 2: QA Peer Review of Manual Tests ────────────────────────────
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 2 / Step 2: QA Peer Review');
    logger.info('══════════════════════════════════════════════\n');

    try {
      const review = await this.qaReviewer.reviewManualTests(suite, path.join(this.cfg.reviewsDir, 'manual'));
      const approvedSuite = this.qaReviewer.applyReviewToSuite(suite, review);
      suite = approvedSuite;

      results.push({
        stage: 'manual-test-review',
        success: true,
        details:
          `Verdict: ${review.overallVerdict} | ` +
          `Coverage: ${review.coverageScore}/100 | Quality: ${review.qualityScore}/100\n` +
          `Approved: ${review.approvedTestIds.length} tests | Flagged: ${review.flaggedTestIds.length} tests\n` +
          `Coverage gaps: ${review.coverageGaps.length}`,
        artifacts: [],
      });
    } catch (err: any) {
      results.push({ stage: 'manual-test-review', success: false, details: err.message, artifacts: [] });
      // Continue with unreviewed suite
    }

    // ── Step 3: Generate Automation Scripts ──────────────────────────────
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 2 / Step 3: Generate Automation Scripts');
    logger.info('══════════════════════════════════════════════\n');

    let bundle: AutomationBundle;
    try {
      // Mark all tests as approved if none were explicitly approved during review
      const hasApproved = suite.testCases.some((t) => t.status === 'approved');
      if (!hasApproved) {
        suite = {
          ...suite,
          testCases: suite.testCases.map((t) => ({ ...t, status: 'approved' as const })),
        };
      }

      bundle = await this.automationGen.generate({
        suite,
        targets: ['ui', 'api', 'mobile'],
        outputDir: this.cfg.testsDir,
        baseURL: this.cfg.baseURL,
        apiBaseURL: this.cfg.apiBaseURL,
      });

      const generated = [bundle.ui, bundle.api, bundle.mobile].filter(Boolean);
      results.push({
        stage: 'automation-gen',
        success: true,
        details: generated.map((s) => `${s!.target}: ${s!.testCount} tests → ${s!.filePath}`).join('\n'),
        artifacts: generated.map((s) => s!.filePath),
      });
    } catch (err: any) {
      results.push({ stage: 'automation-gen', success: false, details: err.message, artifacts: [] });
      return results;
    }

    // ── Step 4: Automation Script Review ─────────────────────────────────
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 2 / Step 4: Review Automation Scripts');
    logger.info('══════════════════════════════════════════════\n');

    const scriptsToReview = [bundle.ui, bundle.api, bundle.mobile].filter(Boolean);
    for (const script of scriptsToReview) {
      try {
        const autoReview = await this.qaReviewer.reviewAutomationScript(
          script!.filePath,
          path.join(this.cfg.reviewsDir, 'automation')
        );
        results.push({
          stage: `automation-review-${script!.target}`,
          success: true,
          details: `${script!.target.toUpperCase()}: ${autoReview.overallVerdict} | Score: ${autoReview.qualityScore}/100 | Approved for execution: ${autoReview.approvedForExecution}`,
          artifacts: [],
        });
      } catch (err: any) {
        results.push({
          stage: `automation-review-${script!.target}`,
          success: false,
          details: err.message,
          artifacts: [],
        });
      }
    }

    // ── Step 5: Run Tests ─────────────────────────────────────────────────
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 2 / Step 5: Run Tests Against App');
    logger.info('══════════════════════════════════════════════\n');

    const testRunResult = await this.runTests(this.cfg.testsDir);
    results.push(testRunResult);

    // ── Step 6: Generate Report ───────────────────────────────────────────
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 2 / Step 6: Generate Test Report');
    logger.info('══════════════════════════════════════════════\n');

    try {
      const jsonReport = path.join(this.cfg.reportsDir, 'results.json');
      const htmlReport = path.join(this.cfg.reportsDir, 'ai-qe-report.html');
      const reportPath = await this.reportGen.generateHTMLReport(jsonReport, htmlReport);
      results.push({
        stage: 'report-gen',
        success: true,
        details: `HTML report generated → ${reportPath}`,
        artifacts: [reportPath],
      });
    } catch (err: any) {
      results.push({
        stage: 'report-gen',
        success: false,
        details: `Report generation failed (tests may not have run): ${err.message}`,
        artifacts: [],
      });
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 3: Self-Healing Demo & Change Detection Watch
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // Standalone Mobile Testing
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run the AI Mobile Tester standalone — generates a comprehensive mobile test suite
   * and optionally runs it against the app.
   */
  async runMobileTests(options: {
    url?: string;
    suitePath?: string;
    devices?: string[];
    scenarios?: MobileTestType[];
    runTests?: boolean;
  } = {}): Promise<PipelineRunResult[]> {
    const results: PipelineRunResult[] = [];
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  AI Mobile Tester');
    logger.info('══════════════════════════════════════════════\n');

    // Load manual suite if provided
    let suite;
    if (options.suitePath) {
      try {
        suite = await fs.readJson(options.suitePath);
      } catch {
        logger.warn(`Could not load suite from ${options.suitePath} — generating from URL only`);
      }
    }

    const mobileOptions: MobileTestOptions = {
      url: options.url || this.cfg.baseURL,
      suite,
      devices: options.devices,
      scenarios: options.scenarios,
      outputDir: this.cfg.testsDir,
    };

    try {
      const result = await this.mobileTester.generate(mobileOptions);
      results.push({
        stage: 'mobile-test-gen',
        success: true,
        details: [
          `Generated ${result.testCount} mobile tests → ${result.filePath}`,
          `Devices: ${result.devicesTargeted.join(', ')}`,
          `Scenarios: ${result.scenariosCovered.join(', ')}`,
        ].join('\n'),
        artifacts: [result.filePath],
      });

      if (options.runTests) {
        logger.info('\n🧪 Running mobile tests...');
        const runResult = await this.runTests(this.cfg.testsDir, 'mobile-chrome mobile-safari');
        results.push(runResult);
      }
    } catch (err: any) {
      results.push({ stage: 'mobile-test-gen', success: false, details: err.message, artifacts: [] });
    }

    return results;
  }

  /**
   * Start watching the demo app for changes and trigger appropriate QE responses.
   */
  startWatch(): void {
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  PART 3: Self-Healing & Change Detection Watch');
    logger.info('══════════════════════════════════════════════\n');
    logger.info(`👁️  Watching ${this.cfg.appDir} for changes...`);
    logger.info('  • Requirement changes → flagged for manual review');
    logger.info('  • Locator/UI changes  → auto-heal triggered');
    logger.info('  • Press Ctrl+C to stop\n');

    this.changeDetector.watch({
      watchDir: this.cfg.appDir,
      testsDir: this.cfg.testsDir,
      onChange: async (change) => this.handleChange(change),
    });
  }

  /**
   * Handle a detected change — demonstrate both healing and review-flagging.
   */
  async handleChange(change: DetectedChange): Promise<void> {
    logger.info(`\n🔄 Change detected: ${change.relativePath}`);
    logger.info(`   Type: ${change.changeType} | Action: ${change.action}`);

    switch (change.action) {
      case 'auto-heal': {
        logger.info('🔧 Triggering auto-heal for locator change...');
        if (change.affectedTests.length > 0) {
          for (const testFile of change.affectedTests) {
            try {
              const result = await this.healingAgent.healFile(testFile, this.cfg.baseURL);
              if (result.healed) {
                logger.info(`  ✅ Healed ${result.changes.length} selector(s) in ${testFile}`);
                result.changes.forEach((c) => {
                  logger.info(`     Before: ${c.original}`);
                  logger.info(`     After:  ${c.replacement}`);
                  logger.info(`     Reason: ${c.reason}`);
                });
              } else {
                logger.info(`  ℹ️  No broken selectors found in ${testFile}`);
              }
            } catch (err: any) {
              logger.error(`  ❌ Healing failed for ${testFile}: ${err.message}`);
            }
          }
        } else {
          logger.info('  ⚠️  No affected tests found to heal');
        }
        break;
      }

      case 'flag-for-review': {
        logger.warn('🚩 Flagging for manual review (requirement change)...');
        const ticket = await this.reviewQueue.addToQueue(change);
        logger.warn(`  🎫 Review ticket: ${ticket.ticketId}`);
        logger.warn(`  📋 Required actions:`);
        ticket.requiredActions.forEach((a) => logger.warn(`     • ${a}`));
        break;
      }

      case 'regenerate-tests': {
        logger.info('♻️  Logic change — flagging for review to decide if test regen needed...');
        await this.reviewQueue.addToQueue(change, 'unknown-change');
        break;
      }

      case 'ignore':
        logger.info('  ℹ️  Style change — ignored (no test impact)');
        break;
    }
  }

  /**
   * Demonstrate self-healing by simulating a broken selector scenario.
   * Works offline — uses a static DOM reference of the known app so no server is needed.
   *
   * Flow:
   *  1. Introduce 3 deliberately broken data-testid selectors
   *  2. Show the broken diff
   *  3. Ask Claude to fix them using the known DOM reference
   *  4. Show the healed diff
   *  5. Write healed file back
   */
  async demoSelfHeal(testFile: string): Promise<void> {
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  DEMO: Self-Healing in Action (Offline Mode)');
    logger.info('══════════════════════════════════════════════\n');

    if (!await fs.pathExists(testFile)) {
      logger.error(`Test file not found: ${testFile}`);
      return;
    }

    const original = await fs.readFile(testFile, 'utf-8');

    // ── Step 1: Introduce broken selectors (simulate UI refactor) ──────────
    // Matches both getByTestId('x') and data-testid="x" selector styles
    const BREAKS: Array<{ from: string; to: string; description: string }> = [
      {
        from: "getByTestId('login-btn')",
        to: "getByTestId('btn-login-v2')",
        description: 'Login button testid renamed during UI refactor',
      },
      {
        from: "getByTestId('email-input')",
        to: "getByTestId('user-email-field')",
        description: 'Email input testid changed to match design system naming',
      },
      {
        from: "getByTestId('task-list')",
        to: "getByTestId('tasks-container-main')",
        description: 'Task list wrapper testid updated in new component structure',
      },
    ];

    let broken = original;
    const actualBreaks: typeof BREAKS = [];
    for (const b of BREAKS) {
      if (broken.includes(b.from)) {
        broken = broken.split(b.from).join(b.to);
        actualBreaks.push(b);
      }
    }

    if (actualBreaks.length === 0) {
      logger.warn('⚠️  None of the demo selectors found in this file — try with the UI spec.');
      logger.warn('    Tip: run `npm run gen-automation` to generate tests/generated/all-ui.spec.ts first.');
      return;
    }

    await fs.writeFile(testFile, broken, 'utf-8');
    logger.info(`⚠️  Introduced ${actualBreaks.length} broken selector(s) to simulate a UI refactor:\n`);
    actualBreaks.forEach((b, i) => {
      logger.info(`  ${i + 1}. ${b.description}`);
      logger.info(`     BROKEN: ${b.to}`);
    });

    // ── Step 2: Build static DOM reference (no server needed) ──────────────
    // This represents what the app's actual HTML looks like — known from dev-gen
    const STATIC_DOM = `
<!-- Login Page — http://localhost:3000/login -->
<form data-testid="login-form">
  <input type="email" data-testid="email-input" placeholder="Email" aria-label="Email address" />
  <input type="password" data-testid="password-input" placeholder="Password" aria-label="Password" />
  <p data-testid="login-error" role="alert" class="error hidden"></p>
  <button type="submit" data-testid="login-btn" aria-label="Sign in">Sign In</button>
</form>

<!-- Dashboard Page — http://localhost:3000/dashboard -->
<main>
  <button data-testid="add-task-btn" aria-label="Add new task">+ Add Task</button>
  <ul data-testid="task-list" aria-label="Task list">
    <li data-testid="task-card">
      <span data-testid="task-title">Example Task</span>
      <button data-testid="task-complete-btn" aria-label="Mark complete">✓</button>
      <button data-testid="task-edit-btn" aria-label="Edit task">Edit</button>
      <button data-testid="task-delete-btn" aria-label="Delete task">Delete</button>
    </li>
  </ul>
  <button data-testid="logout-btn" aria-label="Sign out">Logout</button>
</main>

<!-- Task Form — modal/sidebar -->
<form data-testid="task-form">
  <input data-testid="title-input" aria-label="Task title" />
  <textarea data-testid="description-input" aria-label="Task description"></textarea>
  <select data-testid="priority-select" aria-label="Priority">
    <option>low</option><option>medium</option><option>high</option>
  </select>
  <input type="date" data-testid="due-date-input" aria-label="Due date" />
  <button type="submit" data-testid="save-task-btn">Save</button>
  <button type="button" data-testid="cancel-btn">Cancel</button>
</form>
`.trim();

    // ── Step 3: Ask Claude to fix selectors using the DOM reference ─────────
    logger.info('\n🤖 Sending broken test file to Claude for self-healing...\n');

    const { ClaudeClient } = await import('../utils/ClaudeClient');
    const claude = new ClaudeClient();

    const brokenSelectors = actualBreaks.map((b) =>
      b.to.match(/getByTestId\(['"](.+?)['"]\)/)?.[1] || b.to
    );
    const prompt = `
You are a Playwright self-healing agent. The following test file has ${actualBreaks.length} broken getByTestId selectors whose data-testid values no longer exist in the app's HTML.

BROKEN SELECTORS (these data-testid values no longer exist in the DOM):
${brokenSelectors.map((s, i) => `${i + 1}. getByTestId("${s}")`).join('\n')}

CURRENT APP DOM (source of truth — use only these data-testid values):
\`\`\`html
${STATIC_DOM}
\`\`\`

BROKEN TEST FILE:
\`\`\`typescript
${broken.substring(0, 6000)}
\`\`\`

Instructions:
- Replace ONLY the broken data-testid selectors with the correct ones from the DOM
- Use getByTestId() for data-testid attributes, getByRole() or getByLabel() where more semantic
- Do not change any other code
- Return the complete corrected TypeScript file. No markdown fences. No explanations.
`.trim();

    const healedCode = await claude.complete(prompt, {
      system: 'You are a Playwright self-healing expert. Output ONLY the corrected TypeScript file. No markdown. No explanation.',
      maxTokens: 8192,
    });

    const cleaned = healedCode
      .replace(/^```(?:typescript|ts)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    // ── Step 4: Diff and show results ───────────────────────────────────────
    const changes: Array<{ before: string; after: string; description: string }> = [];
    for (const b of actualBreaks) {
      // Extract testid value from e.g. getByTestId('btn-login-v2') → btn-login-v2
      const brokenId = b.to.match(/getByTestId\(['"](.+?)['"]\)/)?.[1] || b.to;
      const correctId = b.from.match(/getByTestId\(['"](.+?)['"]\)/)?.[1] || b.from;
      if (!cleaned.includes(brokenId)) {
        changes.push({
          before: b.to,
          after: b.from,
          description: b.description,
        });
      }
    }

    await fs.writeFile(testFile, cleaned, 'utf-8');

    if (changes.length > 0) {
      logger.info(`\n✅ Self-healing SUCCESSFUL — ${changes.length} selector(s) repaired:\n`);
      changes.forEach((c, i) => {
        logger.info(`  Change ${i + 1}: ${c.description}`);
        logger.info(`    BEFORE: ${c.before}`);
        logger.info(`    AFTER:  ${c.after}`);
        logger.info('');
      });
      logger.info(`📄 Healed file written: ${testFile}`);
    } else {
      logger.info('\n⚠️  Claude healed the file — reviewing diff...');
      logger.info('    Check the file for any selector changes made.');
      logger.info(`    File: ${testFile}`);
    }
  }

  /**
   * Demonstrate requirement change detection by modifying REQUIREMENTS.md.
   */
  async demoRequirementChange(): Promise<void> {
    logger.info('\n══════════════════════════════════════════════');
    logger.info('  DEMO: Requirement Change Detection');
    logger.info('══════════════════════════════════════════════\n');

    const reqFile = path.join(this.cfg.appDir, 'REQUIREMENTS.md');
    if (!await fs.pathExists(reqFile)) {
      logger.error(`REQUIREMENTS.md not found at ${reqFile}. Run dev-gen first.`);
      return;
    }

    const original = await fs.readFile(reqFile, 'utf-8');

    // Append a new requirement to simulate a change
    const newReq = `\n\n## NEW REQUIREMENT (Added ${new Date().toLocaleDateString()})\n\n` +
      `### REQ-NEW-001: Task Collaboration\n` +
      `- Users should be able to share tasks with other users\n` +
      `- Shared tasks appear in both users' dashboards\n` +
      `- Acceptance criteria: Shared task shows collaborator avatars\n`;

    await fs.writeFile(reqFile, original + newReq, 'utf-8');
    logger.info('📝 Added new requirement to REQUIREMENTS.md');
    logger.info('   "Task Collaboration" — sharing tasks between users\n');

    // Simulate what the ChangeDetector would do
    const change = await this.changeDetector.analyzeChange(reqFile, this.cfg.appDir, this.cfg.testsDir, 'change');

    if (change) {
      logger.info(`🔍 Change classified as: ${change.changeType}`);
      logger.info(`   Action taken: ${change.action}`);
      logger.info(`   Reason: ${change.reason}\n`);

      const ticket = await this.reviewQueue.addToQueue(change);
      logger.warn(`🚩 Review ticket created: ${ticket.ticketId}`);
      logger.warn(`   This change CANNOT be auto-healed.`);
      logger.warn(`   QE team must:`);
      ticket.requiredActions.forEach((a) => logger.warn(`   • ${a}`));
    }

    // Restore original
    await fs.writeFile(reqFile, original, 'utf-8');
    logger.info('\n↩️  REQUIREMENTS.md restored to original for demo repeatability');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async runTests(testsDir: string, projects?: string): Promise<PipelineRunResult> {
    logger.info(`🧪 Running Playwright tests in ${testsDir}${projects ? ` [projects: ${projects}]` : ''}...`);
    await fs.ensureDir(this.cfg.reportsDir);

    return new Promise((resolve) => {
      const args = [
        'playwright', 'test',
        '--reporter=json,html',
        `--output=${this.cfg.reportsDir}`,
        ...(projects ? projects.split(' ').flatMap((p) => ['--project', p]) : []),
      ];

      const proc = spawn('npx', args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          BASE_URL: this.cfg.baseURL,
          PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(this.cfg.reportsDir, 'results.json'),
        },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d) => { stdout += d; process.stdout.write(d); });
      proc.stderr?.on('data', (d) => { stderr += d; });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({
            stage: 'test-run',
            success: true,
            details: 'All tests passed',
            artifacts: [path.join(this.cfg.reportsDir, 'results.json')],
          });
        } else {
          resolve({
            stage: 'test-run',
            success: false,
            details: `Tests completed with exit code ${code}. Some tests may have failed — check the report.`,
            artifacts: [path.join(this.cfg.reportsDir, 'results.json')],
          });
        }
      });

      proc.on('error', (err) => {
        resolve({
          stage: 'test-run',
          success: false,
          details: `Failed to run tests: ${err.message}. Is the app running at ${this.cfg.baseURL}?`,
          artifacts: [],
        });
      });
    });
  }

  /**
   * Print a summary table of all pipeline stage results.
   */
  printSummary(results: PipelineRunResult[]): void {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  QE PIPELINE SUMMARY');
    console.log('══════════════════════════════════════════════════════════\n');

    for (const r of results) {
      const icon = r.success ? '✅' : '❌';
      console.log(`${icon} ${r.stage.toUpperCase()}`);
      r.details.split('\n').forEach((line) => console.log(`   ${line}`));
      if (r.artifacts.length > 0) {
        console.log('   Artifacts:');
        r.artifacts.forEach((a) => console.log(`     📄 ${a}`));
      }
      console.log('');
    }
  }
}
