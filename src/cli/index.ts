#!/usr/bin/env node
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as ora from 'ora';
import chalk from 'chalk';
import { AITestGenerator } from '../agent/AITestGenerator';
import { SelfHealingAgent } from '../agent/SelfHealingAgent';
import { ReportGenerator } from '../agent/ReportGenerator';
import { APITester } from '../agent/APITester';
import { AIDevAgent } from '../agent/AIDevAgent';
import { ManualTestGenerator } from '../agent/ManualTestGenerator';
import { QAReviewAgent } from '../agent/QAReviewAgent';
import { AutomationScriptGenerator } from '../agent/AutomationScriptGenerator';
import { AIMobileTester, MOBILE_DEVICES } from '../agent/AIMobileTester';
import { ReviewQueueManager } from '../agent/ReviewQueueManager';
import { QEPipeline } from '../orchestrator/QEPipeline';
import { logger } from '../utils/Logger';

dotenv.config();

const program = new Command();

program
  .name('ai-qe')
  .description('🤖 AI QE Agent — Intelligent E2E Test Generation & Self-Healing')
  .version('1.0.0');

// ─── generate ───────────────────────────────────────────────────────────────
program
  .command('generate')
  .alias('gen')
  .description('Generate E2E tests from a URL, requirements, or both')
  .option('-u, --url <url>', 'URL of the page to analyze')
  .option('-r, --requirements <text>', 'Plain-English requirements or user story')
  .option('-n, --name <name>', 'Output file name (without extension)')
  .option('-o, --output <dir>', 'Output directory', 'tests/generated')
  .option('--max-tests <number>', 'Maximum tests to generate per page', '10')
  .option('--accessibility', 'Include accessibility tests')
  .option('--performance', 'Include performance assertions')
  .action(async (options) => {
    if (!options.url && !options.requirements) {
      console.error(chalk.red('❌ Provide at least --url or --requirements'));
      process.exit(1);
    }

    const spinner = ora.default(chalk.cyan('🤖 AI is analyzing and writing tests...')).start();

    try {
      const generator = new AITestGenerator();
      const result = await generator.generate({
        url: options.url,
        requirements: options.requirements,
        testName: options.name,
        outputDir: options.output,
        maxTests: parseInt(options.maxTests),
        includeAccessibility: options.accessibility,
        includePerformance: options.performance,
      });

      spinner.succeed(chalk.green(`✅ Generated ${result.testCount} tests!`));
      console.log(chalk.blue(`📄 File: ${result.filePath}`));
      console.log(chalk.gray('\nTests created:'));
      result.testNames.forEach((name) => console.log(chalk.gray(`  • ${name}`)));
      console.log(chalk.yellow('\n▶  Run them with: npx playwright test'));
    } catch (err: any) {
      spinner.fail(chalk.red(`Generation failed: ${err.message}`));
      logger.error(err);
      process.exit(1);
    }
  });

// ─── generate-api ────────────────────────────────────────────────────────────
program
  .command('generate-api')
  .alias('gen-api')
  .description('Generate REST API tests from endpoint definitions or OpenAPI spec')
  .option('--spec <path>', 'Path to OpenAPI/Swagger spec file (JSON or YAML)')
  .option('--spec-url <url>', 'URL of OpenAPI/Swagger spec')
  .option('--base-url <url>', 'API base URL')
  .option('-n, --name <name>', 'Output file name')
  .option('-o, --output <dir>', 'Output directory', 'tests/generated')
  .option('--auth <type>', 'Auth type: none|bearer|basic|apikey', 'none')
  .action(async (options) => {
    const spinner = ora.default(chalk.cyan('🌐 Generating API tests...')).start();
    try {
      const tester = new APITester();
      const filePath = await tester.generateFromOpenAPISpec({
        openapiSpecPath: options.spec,
        openapiSpecURL: options.specUrl,
        baseURL: options.baseUrl,
        testName: options.name,
        outputDir: options.output,
        authType: options.auth,
      });
      spinner.succeed(chalk.green(`✅ API tests generated!`));
      console.log(chalk.blue(`📄 File: ${filePath}`));
    } catch (err: any) {
      spinner.fail(chalk.red(`API test generation failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── heal ───────────────────────────────────────────────────────────────────
program
  .command('heal')
  .description('Self-heal broken selectors in generated test files')
  .option('-u, --url <url>', 'Target application URL (required)')
  .option('-f, --file <path>', 'Heal a specific test file')
  .option('-d, --dir <dir>', 'Heal all tests in a directory', 'tests/generated')
  .option('--watch', 'Watch mode — heal on interval')
  .option('--interval <ms>', 'Watch interval in milliseconds', '60000')
  .action(async (options) => {
    if (!options.url) {
      console.error(chalk.red('❌ --url is required for self-healing'));
      process.exit(1);
    }

    const agent = new SelfHealingAgent();

    if (options.watch) {
      console.log(chalk.cyan('👁️  Starting watch mode...'));
      await agent.watchAndHeal(options.url, { interval: parseInt(options.interval) });
      return;
    }

    const spinner = ora.default(chalk.cyan('🔧 Running self-healing...')).start();
    try {
      let results;
      if (options.file) {
        const result = await agent.healFile(options.file, options.url);
        results = [result];
      } else {
        results = await agent.healAll(options.url, options.dir);
      }

      const healed = results.filter((r) => r.healed);
      spinner.succeed(
        chalk.green(`✅ Healed ${healed.length}/${results.length} test file(s)`)
      );

      healed.forEach((r) => {
        console.log(chalk.blue(`\n📄 ${r.filePath}`));
        r.changes.forEach((c) => {
          console.log(chalk.gray(`  Before: ${c.original}`));
          console.log(chalk.green(`  After:  ${c.replacement}`));
        });
      });
    } catch (err: any) {
      spinner.fail(chalk.red(`Healing failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── report ─────────────────────────────────────────────────────────────────
program
  .command('report')
  .description('Generate AI-powered HTML test report from Playwright results')
  .option('-i, --input <path>', 'Input JSON report path', 'reports/results.json')
  .option('-o, --output <path>', 'Output HTML report path', 'reports/ai-qe-report.html')
  .action(async (options) => {
    const spinner = ora.default(chalk.cyan('📊 Generating report...')).start();
    try {
      const reporter = new ReportGenerator();
      const outputPath = await reporter.generateHTMLReport(options.input, options.output);
      spinner.succeed(chalk.green(`✅ Report generated!`));
      console.log(chalk.blue(`📊 Open: ${outputPath}`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Report generation failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── interactive ─────────────────────────────────────────────────────────────
program
  .command('interactive')
  .alias('i')
  .description('Interactive wizard — guided test generation')
  .action(async () => {
    const inquirer = (await import('inquirer')).default;

    console.log(chalk.cyan.bold('\n🤖 AI QE Agent — Interactive Mode\n'));

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'What would you like to do?',
        choices: [
          { name: '🌐 Generate tests from a URL', value: 'url' },
          { name: '📝 Generate tests from requirements', value: 'requirements' },
          { name: '📱 Generate mobile tests (AI Mobile Tester)', value: 'mobile' },
          { name: '🔧 Self-heal broken tests', value: 'heal' },
          { name: '📊 Generate HTML report', value: 'report' },
          { name: '🌐 Generate API tests from OpenAPI spec', value: 'api' },
          { name: '🚀 Run full QE pipeline', value: 'pipeline' },
        ],
      },
    ]);

    if (answers.mode === 'url') {
      const { url, name, maxTests } = await inquirer.prompt([
        { type: 'input', name: 'url', message: 'Enter the URL to test:', validate: (v: string) => !!v || 'URL is required' },
        { type: 'input', name: 'name', message: 'Test file name (optional):' },
        { type: 'number', name: 'maxTests', message: 'Max tests to generate:', default: 10 },
      ]);

      const spinner = ora.default('🤖 Generating tests...').start();
      const generator = new AITestGenerator();
      const result = await generator.generateFromURL({ url, testName: name, maxTests });
      spinner.succeed(`✅ ${result.testCount} tests → ${result.filePath}`);

    } else if (answers.mode === 'requirements') {
      const { requirements, name } = await inquirer.prompt([
        { type: 'editor', name: 'requirements', message: 'Enter your requirements:' },
        { type: 'input', name: 'name', message: 'Test file name (optional):' },
      ]);

      const spinner = ora.default('🤖 Generating tests...').start();
      const generator = new AITestGenerator();
      const result = await generator.generateFromRequirements({ requirements, testName: name });
      spinner.succeed(`✅ ${result.testCount} tests → ${result.filePath}`);

    } else if (answers.mode === 'heal') {
      const { url, dir } = await inquirer.prompt([
        { type: 'input', name: 'url', message: 'Target URL:', validate: (v: string) => !!v || 'URL required' },
        { type: 'input', name: 'dir', message: 'Tests directory:', default: 'tests/generated' },
      ]);
      const spinner = ora.default('🔧 Self-healing...').start();
      const agent = new SelfHealingAgent();
      const results = await agent.healAll(url, dir);
      spinner.succeed(`✅ Healed ${results.filter((r) => r.healed).length} files`);

    } else if (answers.mode === 'report') {
      const reporter = new ReportGenerator();
      const spinner = ora.default('📊 Generating report...').start();
      const output = await reporter.generateHTMLReport();
      spinner.succeed(`✅ Report → ${output}`);

    } else if (answers.mode === 'api') {
      const { specPath, baseURL } = await inquirer.prompt([
        { type: 'input', name: 'specPath', message: 'Path to OpenAPI spec file:' },
        { type: 'input', name: 'baseURL', message: 'API base URL:' },
      ]);
      const spinner = ora.default('🌐 Generating API tests...').start();
      const tester = new APITester();
      const filePath = await tester.generateFromOpenAPISpec({ openapiSpecPath: specPath, baseURL });
      spinner.succeed(`✅ API tests → ${filePath}`);

    } else if (answers.mode === 'mobile') {
      const { url, deviceChoice, scenarioChoice } = await inquirer.prompt([
        { type: 'input', name: 'url', message: 'App URL to test:', default: 'http://localhost:3000' },
        {
          type: 'checkbox',
          name: 'deviceChoice',
          message: 'Select devices to target:',
          choices: MOBILE_DEVICES.map((d) => ({ name: `${d.name} (${d.platform})`, value: d.name, checked: ['iPhone 13', 'Pixel 5'].includes(d.name) })),
        },
        {
          type: 'checkbox',
          name: 'scenarioChoice',
          message: 'Select test scenarios:',
          choices: AIMobileTester.getAvailableScenarios().map((s) => ({ name: s, value: s, checked: ['layout', 'navigation', 'touch', 'forms'].includes(s) })),
        },
      ]);
      const spinner = ora.default('📱 Generating mobile tests...').start();
      const mobileTester = new AIMobileTester();
      const result = await mobileTester.generate({
        url,
        devices: deviceChoice,
        scenarios: scenarioChoice,
        outputDir: 'tests/generated',
      });
      spinner.succeed(`✅ ${result.testCount} mobile tests → ${result.filePath}`);
      console.log(`   Devices: ${result.devicesTargeted.join(', ')}`);
      console.log(`   Run: npx playwright test --project=mobile-chrome ${result.filePath}`);

    } else if (answers.mode === 'pipeline') {
      const { component, baseURL } = await inquirer.prompt([
        { type: 'input', name: 'component', message: 'Component to focus on (or "all"):', default: 'all' },
        { type: 'input', name: 'baseURL', message: 'App base URL:', default: 'http://localhost:3000' },
      ]);
      console.log(chalk.cyan('\n🤖 Running full QE pipeline...\n'));
      const pipeline = new QEPipeline({ baseURL });
      const pipelineResults = await pipeline.runQEWorkflow(component);
      pipeline.printSummary(pipelineResults);
    }
  });

// ─── dev-gen ─────────────────────────────────────────────────────────────────
program
  .command('dev-gen')
  .description('AI Dev Agent: Generate a full-stack demo app (React + Express + SQLite)')
  .option('-n, --name <name>', 'App name', 'TaskMaster')
  .option('-o, --output <dir>', 'Output directory', 'demo-app')
  .action(async (options) => {
    const spinner = ora.default(chalk.cyan('🏗️  AI Dev Agent generating full-stack app...')).start();
    try {
      const agent = new AIDevAgent();
      const result = await agent.generateApp({
        appName: options.name,
        description: 'A full-stack Task Manager with auth, CRUD tasks, priorities, due dates, mobile-responsive UI',
        features: [
          'User registration and login with JWT authentication',
          'Create, read, update, delete tasks',
          'Task fields: title, description, priority, due date, completion status',
          'Filter tasks by status and priority',
          'Mobile-responsive layout',
          'REST API: /api/auth and /api/tasks',
          'SQLite database',
        ],
        outputDir: options.output,
      });
      spinner.succeed(chalk.green(`✅ App generated! ${result.files.length} files written`));
      console.log(chalk.blue(`📁 Location: ${result.outputDir}`));
      console.log(chalk.yellow(`\n🚀 Setup: ${result.setupInstructions}`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Dev gen failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── manual-tests ─────────────────────────────────────────────────────────────
program
  .command('manual-tests')
  .alias('mt')
  .description('Generate structured manual test cases from a requirements file')
  .option('-r, --requirements <path>', 'Path to requirements file', 'demo-app/REQUIREMENTS.md')
  .option('-c, --component <name>', 'Component/area to focus on', 'all')
  .option('-o, --output <dir>', 'Output directory', 'tests/manual')
  .action(async (options) => {
    const spinner = ora.default(chalk.cyan('📋 Generating manual test cases...')).start();
    try {
      const gen = new ManualTestGenerator();
      const suite = await gen.generate({
        requirementsPath: options.requirements,
        component: options.component,
        outputDir: options.output,
      });
      spinner.succeed(chalk.green(`✅ Generated ${suite.testCases.length} manual test cases`));
      console.log(chalk.blue(`📁 Output: ${options.output}`));
      console.log(chalk.gray(`\nCoverage breakdown:`));
      Object.entries(suite.coverageSummary).forEach(([type, count]) => {
        console.log(chalk.gray(`  ${type}: ${count}`));
      });
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── qa-review ────────────────────────────────────────────────────────────────
program
  .command('qa-review')
  .alias('review')
  .description('QA Peer Review: review manual test cases or automation scripts')
  .option('-t, --type <type>', 'Review type: manual | automation', 'manual')
  .option('-f, --file <path>', 'Path to JSON suite file (for manual) or .spec.ts file (for automation)')
  .option('-o, --output <dir>', 'Review output directory', 'tests/reviews')
  .action(async (options) => {
    if (!options.file) {
      console.error(chalk.red('❌ --file is required'));
      process.exit(1);
    }
    const spinner = ora.default(chalk.cyan('🔍 QA Reviewer analysing...')).start();
    try {
      const reviewer = new QAReviewAgent();
      if (options.type === 'automation') {
        const review = await reviewer.reviewAutomationScript(options.file, options.output);
        spinner.succeed(chalk.green(`✅ Automation review: ${review.overallVerdict}`));
        console.log(chalk.blue(`  Quality score: ${review.qualityScore}/100`));
        console.log(chalk.blue(`  Approved for execution: ${review.approvedForExecution ? 'Yes' : 'No'}`));
        if (review.issues.length > 0) {
          console.log(chalk.yellow(`\n⚠️  Issues found (${review.issues.length}):`));
          review.issues.forEach((i) => console.log(chalk.gray(`  [${i.severity}] ${i.description}`)));
        }
      } else {
        // Manual test review — load suite from JSON file
        const fs = await import('fs-extra');
        const suite = await fs.default.readJson(options.file);
        const review = await reviewer.reviewManualTests(suite, options.output);
        spinner.succeed(chalk.green(`✅ Manual test review: ${review.overallVerdict}`));
        console.log(chalk.blue(`  Coverage: ${review.coverageScore}/100 | Quality: ${review.qualityScore}/100`));
        console.log(chalk.blue(`  Approved: ${review.approvedTestIds.length} | Flagged: ${review.flaggedTestIds.length}`));
        if (review.coverageGaps.length > 0) {
          console.log(chalk.yellow('\nCoverage gaps:'));
          review.coverageGaps.forEach((g) => console.log(chalk.gray(`  ⚠️  ${g}`)));
        }
      }
      console.log(chalk.blue(`\n📋 Report saved to: ${options.output}`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Review failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── gen-automation ──────────────────────────────────────────────────────────
program
  .command('gen-automation')
  .alias('ga')
  .description('Generate UI, API, and Mobile automation scripts from an approved manual test suite')
  .option('-s, --suite <path>', 'Path to approved manual test suite JSON file')
  .option('-t, --targets <targets>', 'Comma-separated targets: ui,api,mobile', 'ui,api,mobile')
  .option('-o, --output <dir>', 'Output directory', 'tests/generated')
  .option('--base-url <url>', 'App base URL', 'http://localhost:3000')
  .option('--api-url <url>', 'API base URL', 'http://localhost:3001')
  .action(async (options) => {
    if (!options.suite) {
      console.error(chalk.red('❌ --suite is required (path to manual test suite JSON)'));
      process.exit(1);
    }
    const spinner = ora.default(chalk.cyan('🤖 Generating automation scripts...')).start();
    try {
      const fs = await import('fs-extra');
      const suite = await fs.default.readJson(options.suite);
      // Approve all tests if none are marked approved
      if (!suite.testCases.some((t: any) => t.status === 'approved')) {
        suite.testCases = suite.testCases.map((t: any) => ({ ...t, status: 'approved' }));
      }
      const targets = options.targets.split(',').map((t: string) => t.trim());
      const gen = new AutomationScriptGenerator();
      const bundle = await gen.generate({
        suite,
        targets,
        outputDir: options.output,
        baseURL: options.baseUrl,
        apiBaseURL: options.apiUrl,
      });
      spinner.succeed(chalk.green('✅ Automation scripts generated!'));
      [bundle.ui, bundle.api, bundle.mobile].filter(Boolean).forEach((s) => {
        console.log(chalk.blue(`  ${s!.target.toUpperCase()}: ${s!.testCount} tests → ${s!.filePath}`));
      });
      console.log(chalk.yellow('\n▶  Run them: npx playwright test'));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── mobile-test ─────────────────────────────────────────────────────────────
program
  .command('mobile-test')
  .alias('mobile')
  .description('AI Mobile Tester: generate comprehensive mobile/responsive Playwright tests')
  .option('-u, --url <url>', 'Live URL to analyse for page structure')
  .option('-s, --suite <path>', 'Path to approved manual test suite JSON (optional)')
  .option('-d, --devices <list>', 'Comma-separated device names', 'iPhone 13,Pixel 5,iPad Mini')
  .option(
    '--scenarios <list>',
    'Comma-separated scenarios: layout,navigation,touch,orientation,network,performance,accessibility,pwa,forms,media',
    'layout,navigation,touch,orientation,network,performance,forms'
  )
  .option('-n, --name <name>', 'Output test file name')
  .option('-o, --output <dir>', 'Output directory', 'tests/generated')
  .option('--run', 'Run generated tests immediately after generation')
  .option('--list-devices', 'List all available device profiles and exit')
  .option('--list-scenarios', 'List all available scenario types and exit')
  .action(async (options) => {
    if (options.listDevices) {
      console.log(chalk.cyan('\n📱 Available Device Profiles:\n'));
      MOBILE_DEVICES.forEach((d) => {
        console.log(chalk.white(`  ${d.name.padEnd(20)} ${d.playwrightDevice.padEnd(22)} ${d.width}×${d.height}  ${d.platform}`));
      });
      console.log('');
      return;
    }

    if (options.listScenarios) {
      console.log(chalk.cyan('\n📋 Available Test Scenarios:\n'));
      AIMobileTester.getAvailableScenarios().forEach((s) => {
        const descriptions: Record<string, string> = {
          layout:        'Responsive layout at multiple breakpoints',
          navigation:    'Hamburger menus, bottom nav, mobile drawer',
          touch:         'Tap targets, touch events, gesture interactions',
          orientation:   'Portrait ↔ landscape switching',
          network:       'Offline mode, slow 3G simulation, API errors',
          performance:   'Page load time, LCP, CLS on mobile',
          accessibility: 'ARIA roles, keyboard nav, screen reader hints',
          pwa:           'Manifest, service worker, install prompt',
          forms:         'Mobile keyboard, autocomplete, input types',
          media:         'Images, videos, srcset scaling on mobile',
        };
        console.log(chalk.white(`  ${s.padEnd(16)} ${chalk.gray(descriptions[s] || '')}`));
      });
      console.log('');
      return;
    }

    if (!options.url && !options.suite) {
      console.error(chalk.red('❌ Provide --url or --suite (or both)'));
      process.exit(1);
    }

    const deviceList = options.devices.split(',').map((d: string) => d.trim());
    const scenarioList = options.scenarios.split(',').map((s: string) => s.trim());

    console.log(chalk.cyan.bold('\n📱 AI Mobile Tester\n'));
    console.log(chalk.gray(`  Devices:   ${deviceList.join(', ')}`));
    console.log(chalk.gray(`  Scenarios: ${scenarioList.join(', ')}\n`));

    const spinner = ora.default(chalk.cyan('🤖 Generating mobile test suite...')).start();
    try {
      const mobileTester = new AIMobileTester();

      let suite;
      if (options.suite) {
        const fsExtra = await import('fs-extra');
        suite = await fsExtra.default.readJson(options.suite);
        if (!suite.testCases.some((t: any) => t.status === 'approved')) {
          suite.testCases = suite.testCases.map((t: any) => ({ ...t, status: 'approved' }));
        }
      }

      const result = await mobileTester.generate({
        url: options.url,
        suite,
        devices: deviceList,
        scenarios: scenarioList,
        outputDir: options.output,
        testName: options.name,
      });

      spinner.succeed(chalk.green(`✅ Generated ${result.testCount} mobile tests`));
      console.log(chalk.blue(`\n📄 File: ${result.filePath}`));
      console.log(chalk.blue(`📱 Devices targeted: ${result.devicesTargeted.join(', ')}`));
      console.log(chalk.blue(`🧪 Scenarios covered: ${result.scenariosCovered.join(', ')}`));
      console.log(chalk.gray('\nTests:'));
      result.testNames.slice(0, 10).forEach((n) => console.log(chalk.gray(`  • ${n}`)));
      if (result.testNames.length > 10) {
        console.log(chalk.gray(`  ... and ${result.testNames.length - 10} more`));
      }

      if (options.run) {
        console.log(chalk.yellow('\n▶  Running mobile tests against mobile-chrome and mobile-safari...'));
        const pipeline = new QEPipeline({ baseURL: options.url || 'http://localhost:3000' });
        const runResults = await pipeline.runMobileTests({ runTests: true });
        pipeline.printSummary(runResults.filter((r) => r.stage === 'test-run'));
      } else {
        console.log(chalk.yellow(`\n▶  Run them: npx playwright test --project=mobile-chrome ${result.filePath}`));
        console.log(chalk.yellow(`             npx playwright test --project=mobile-safari  ${result.filePath}`));
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Mobile test generation failed: ${err.message}`));
      process.exit(1);
    }
  });

// ─── pipeline ────────────────────────────────────────────────────────────────
program
  .command('pipeline')
  .description('Run the full QE pipeline: Manual Tests → Review → Automation → Test Run → Report')
  .option('-c, --component <name>', 'Component to focus on', 'all')
  .option('--base-url <url>', 'App base URL', 'http://localhost:3000')
  .option('--api-url <url>', 'API base URL', 'http://localhost:3001')
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n🤖 AI QE Agent — Full Pipeline\n'));
    const pipeline = new QEPipeline({
      baseURL: options.baseUrl,
      apiBaseURL: options.apiUrl,
    });
    const results = await pipeline.runQEWorkflow(options.component);
    pipeline.printSummary(results);
  });

// ─── watch ───────────────────────────────────────────────────────────────────
program
  .command('watch')
  .description('Watch demo-app/ for changes and auto-trigger self-healing or flag for review')
  .option('-d, --dir <dir>', 'Directory to watch', 'demo-app')
  .option('--base-url <url>', 'App base URL for self-healing', 'http://localhost:3000')
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n🤖 AI QE Agent — Change Watch Mode\n'));
    const pipeline = new QEPipeline({ appDir: options.dir, baseURL: options.baseUrl });
    pipeline.startWatch();
    // Keep process alive
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n👋 Watch mode stopped'));
      process.exit(0);
    });
  });

// ─── review-queue ─────────────────────────────────────────────────────────────
program
  .command('review-queue')
  .alias('rq')
  .description('View the review queue — items requiring human review before tests can be regenerated')
  .option('--html', 'Also generate HTML dashboard')
  .option('-o, --output <path>', 'HTML report output path', 'reports/review-queue.html')
  .action(async (options) => {
    const manager = new ReviewQueueManager();
    await manager.printQueue();
    if (options.html) {
      const path = await manager.generateQueueReport(options.output);
      console.log(chalk.blue(`📊 HTML report: ${path}`));
    }
  });

// ─── demo ─────────────────────────────────────────────────────────────────────
program
  .command('demo')
  .description('Run a full demo: generate app, run QE pipeline, show self-healing, show req change detection')
  .option('--part <n>', 'Run only a specific part: 1=dev-gen, 2=qe-pipeline, 3=self-heal, 4=req-change', 'all')
  .option('--base-url <url>', 'App base URL', 'http://localhost:3000')
  .option('--api-url <url>', 'API base URL', 'http://localhost:3001')
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n╔══════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║   AI QE Agent — Full Demo                ║'));
    console.log(chalk.cyan.bold('╚══════════════════════════════════════════╝\n'));

    const pipeline = new QEPipeline({
      baseURL: options.baseUrl,
      apiBaseURL: options.apiUrl,
    });

    if (options.part === 'all' || options.part === '1') {
      console.log(chalk.yellow('\n━━━ PART 1: AI Dev Agent ━━━━━━━━━━━━━━━━━━\n'));
      const result = await pipeline.runDevGen();
      console.log(result.success ? chalk.green('✅ ' + result.details) : chalk.red('❌ ' + result.details));
    }

    if (options.part === 'all' || options.part === '2') {
      console.log(chalk.yellow('\n━━━ PART 2: QE Pipeline ━━━━━━━━━━━━━━━━━━\n'));
      const results = await pipeline.runQEWorkflow('all');
      pipeline.printSummary(results);
    }

    if (options.part === 'all' || options.part === '3') {
      console.log(chalk.yellow('\n━━━ PART 3: Self-Healing Demo ━━━━━━━━━━━━\n'));
      // Find a UI test file to demo healing on
      const fs = await import('fs-extra');
      const testFiles = await (await import('fs-extra')).default.readdir('tests/generated').catch(() => []);
      const uiTest = testFiles.find((f: string) => f.includes('-ui.spec.ts'));
      if (uiTest) {
        await pipeline.demoSelfHeal(`tests/generated/${uiTest}`);
      } else {
        console.log(chalk.gray('  No UI test file found — run part 2 first to generate automation scripts'));
      }
    }

    if (options.part === 'all' || options.part === '4') {
      console.log(chalk.yellow('\n━━━ PART 4: Requirement Change Detection ━━\n'));
      await pipeline.demoRequirementChange();
    }

    console.log(chalk.green.bold('\n✅ Demo complete!\n'));
  });

program.parse(process.argv);

// Default: show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
