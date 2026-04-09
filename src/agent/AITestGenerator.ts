import * as path from 'path';
import { ClaudeClient } from '../utils/ClaudeClient';
import { PageAnalyzer, PageAnalysis } from './PageAnalyzer';
import { saveTestFile, slugify } from '../utils/FileUtils';
import { logger } from '../utils/Logger';

export interface GenerationOptions {
  url?: string;
  requirements?: string;
  testName?: string;
  outputDir?: string;
  maxTests?: number;
  includeAccessibility?: boolean;
  includePerformance?: boolean;
}

export interface GeneratedTest {
  filePath: string;
  testCount: number;
  testNames: string[];
}

const SYSTEM_PROMPT = `You are an expert QA automation engineer specializing in Playwright with TypeScript.
Your job is to generate production-ready, maintainable E2E test suites.

Rules:
- Always use Playwright's recommended locators: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId — prefer these over CSS/XPath selectors.
- Use the Page Object Model (POM) pattern when there are 5+ interactions.
- Every test must have a descriptive name following the pattern: "should <action> when <condition>".
- Use test.describe() to group related tests.
- Include beforeEach/afterEach hooks where appropriate.
- Add expect() assertions after every meaningful action.
- Handle async/await properly — every Playwright call must be awaited.
- Add comments explaining the test intent.
- Do NOT use deprecated Playwright APIs.
- Output ONLY valid TypeScript code, no markdown, no explanation text.`;

export class AITestGenerator {
  private claude: ClaudeClient;
  private analyzer: PageAnalyzer;

  constructor() {
    this.claude = new ClaudeClient();
    this.analyzer = new PageAnalyzer();
  }

  /**
   * Generate E2E tests by analyzing a live URL.
   */
  async generateFromURL(options: GenerationOptions): Promise<GeneratedTest> {
    if (!options.url) throw new Error('URL is required for generateFromURL');

    logger.info(`🤖 Generating tests from URL: ${options.url}`);

    const analysis = await this.analyzer.analyze(options.url);
    const prompt = this.buildURLPrompt(analysis, options);

    const code = await this.claude.complete(prompt, { system: SYSTEM_PROMPT });
    const cleanCode = this.cleanCode(code);

    const name = options.testName || slugify(analysis.title || new URL(options.url).pathname);
    const outputDir = options.outputDir || process.env.GENERATED_TESTS_DIR || 'tests/generated';
    const filePath = await saveTestFile(cleanCode, `${name}.spec.ts`, outputDir);

    const testNames = this.extractTestNames(cleanCode);
    logger.info(`✅ Generated ${testNames.length} tests for ${options.url}`);

    return { filePath, testCount: testNames.length, testNames };
  }

  /**
   * Generate E2E tests from plain-English requirements.
   */
  async generateFromRequirements(options: GenerationOptions): Promise<GeneratedTest> {
    if (!options.requirements) throw new Error('Requirements text is required');

    logger.info(`🤖 Generating tests from requirements...`);

    const prompt = this.buildRequirementsPrompt(options);
    const code = await this.claude.complete(prompt, { system: SYSTEM_PROMPT });
    const cleanCode = this.cleanCode(code);

    const name =
      options.testName ||
      slugify(options.requirements.substring(0, 40)) ||
      `generated-${Date.now()}`;
    const outputDir = options.outputDir || process.env.GENERATED_TESTS_DIR || 'tests/generated';
    const filePath = await saveTestFile(cleanCode, `${name}.spec.ts`, outputDir);

    const testNames = this.extractTestNames(cleanCode);
    logger.info(`✅ Generated ${testNames.length} tests from requirements`);

    return { filePath, testCount: testNames.length, testNames };
  }

  /**
   * Generate both from URL + requirements combined.
   */
  async generate(options: GenerationOptions): Promise<GeneratedTest> {
    if (options.url && options.requirements) {
      // Combine: analyze the page and enhance with requirements
      logger.info(`🤖 Combining URL analysis + requirements for test generation...`);
      const analysis = await this.analyzer.analyze(options.url);
      const prompt = this.buildCombinedPrompt(analysis, options);
      const code = await this.claude.complete(prompt, { system: SYSTEM_PROMPT });
      const cleanCode = this.cleanCode(code);

      const name = options.testName || slugify(analysis.title || 'combined');
      const outputDir = options.outputDir || process.env.GENERATED_TESTS_DIR || 'tests/generated';
      const filePath = await saveTestFile(cleanCode, `${name}.spec.ts`, outputDir);
      const testNames = this.extractTestNames(cleanCode);

      return { filePath, testCount: testNames.length, testNames };
    }

    if (options.url) return this.generateFromURL(options);
    if (options.requirements) return this.generateFromRequirements(options);

    throw new Error('Either url or requirements (or both) must be provided');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildURLPrompt(analysis: PageAnalysis, options: GenerationOptions): string {
    const maxTests = options.maxTests || parseInt(process.env.MAX_TESTS_PER_PAGE || '10');
    return `
Generate a comprehensive Playwright TypeScript test suite for the following web page.

PAGE INFORMATION:
- URL: ${analysis.url}
- Title: ${analysis.title}
- Description: ${analysis.description}

PAGE ELEMENTS:
Forms (${analysis.forms.length}):
${JSON.stringify(analysis.forms, null, 2)}

Buttons (${analysis.buttons.length}):
${JSON.stringify(analysis.buttons.slice(0, 15), null, 2)}

Links (${analysis.links.length}):
${JSON.stringify(analysis.links.slice(0, 10), null, 2)}

Headings: ${analysis.headings.join(', ')}

Tables: ${JSON.stringify(analysis.tables, null, 2)}

REQUIREMENTS:
- Generate up to ${maxTests} meaningful test cases
- Cover: navigation, form validation (valid + invalid data), button interactions, error states
${options.includeAccessibility ? '- Include accessibility tests (ARIA roles, keyboard navigation)' : ''}
${options.includePerformance ? '- Include a basic performance assertion (page load < 3s)' : ''}
- Use baseURL from playwright config (do not hardcode the full URL)
- The test file should be self-contained and runnable

Output ONLY the TypeScript test file content.
`.trim();
  }

  private buildRequirementsPrompt(options: GenerationOptions): string {
    const baseURL = process.env.BASE_URL || 'http://localhost:3000';
    return `
Generate a comprehensive Playwright TypeScript test suite based on these requirements:

BASE URL: ${baseURL}

REQUIREMENTS / USER STORY:
${options.requirements}

INSTRUCTIONS:
- Generate complete, runnable test code
- Cover happy path, edge cases, and negative scenarios
- Use descriptive test names
- Group tests logically with test.describe()
- Add clear comments explaining each test's purpose

Output ONLY the TypeScript test file content.
`.trim();
  }

  private buildCombinedPrompt(analysis: PageAnalysis, options: GenerationOptions): string {
    return `
Generate a Playwright TypeScript test suite based on both the live page analysis and the stated requirements.

PAGE ANALYSIS:
${JSON.stringify({ title: analysis.title, forms: analysis.forms, buttons: analysis.buttons.slice(0, 10), headings: analysis.headings }, null, 2)}

REQUIREMENTS:
${options.requirements}

Cover both what the page currently has AND what the requirements specify.
Output ONLY the TypeScript test file content.
`.trim();
  }

  private cleanCode(raw: string): string {
    return raw
      .replace(/^```(?:typescript|ts)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
  }

  private extractTestNames(code: string): string[] {
    const matches = code.match(/test\(['"`](.+?)['"`]/g) || [];
    return matches.map((m) => m.replace(/test\(['"`]/, '').replace(/['"`]$/, ''));
  }
}
