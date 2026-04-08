#!/usr/bin/env node
import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as ora from 'ora';
import * as chalk from 'chalk';
import { AITestGenerator } from '../agent/AITestGenerator';
import { SelfHealingAgent } from '../agent/SelfHealingAgent';
import { ReportGenerator } from '../agent/ReportGenerator';
import { APITester } from '../core/APITester';
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
          { name: '🔧 Self-heal broken tests', value: 'heal' },
          { name: '📊 Generate HTML report', value: 'report' },
          { name: '🌐 Generate API tests from OpenAPI spec', value: 'api' },
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
    }
  });

program.parse(process.argv);

// Default: show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
