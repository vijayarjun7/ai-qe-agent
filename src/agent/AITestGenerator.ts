import { ClaudeClient } from '../utils/ClaudeClient';
import { PageAnalyzer, PageAnalysis } from '../core/PageAnalyzer';
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
Generate production-ready, maintainable E2E test suites.
Rules:
- Use getByRole, getByLabel, getByPlaceholder, getByText, getByTestId over CSS/XPath.
- Use Page Object Model for 5+ interactions.
- Every test: "should <action> when <condition>".
- Use test.describe() to group tests.
- Include beforeEach/afterEach hooks where appropriate.
- Add expect() assertions after every meaningful action.
- Output ONLY valid TypeScript code.`;

export class AITestGenerator {
  private claude: ClaudeClient;
  private analyzer: PageAnalyzer;

  constructor() {
    this.claude = new ClaudeClient();
    this.analyzer = new PageAnalyzer();
  }

  async generateFromURL(options: GenerationOptions): Promise<GeneratedTest> {
    if (!options.url) throw new Error('URL is required');
    logger.info(`🤖 Generating tests from URL: ${options.url}`);
    const analysis = await this.analyzer.analyze(options.url);
    const prompt = this.buildURLPrompt(analysis, options);
    const code = await this.claude.complete(prompt, { system: SYSTEM_PROMPT });
    const cleanCode = this.cleanCode(code);
    const name = options.testName || slugify(analysis.title || new URL(options.url).pathname);
    const outputDir = options.outputDir || 'tests/generated';
    const filePath = await saveTestFile(cleanCode, `${name}.spec.ts`, outputDir);
    const testNames = this.extractTestNames(cleanCode);
    return { filePath, testCount: testNames.length, testNames };
  }

  async generateFromRequirements(options: GenerationOptions): Promise<GeneratedTest> {
    if (!options.requirements) throw new Error('Requirements text is required');
    logger.info('🤖 Generating tests from requirements...');
    const prompt = this.buildRequirementsPrompt(options);
    const code = await this.claude.complete(prompt, { system: SYSTEM_PROMPT });
    const cleanCode = this.cleanCode(code);
    const name = options.testName || slugify(options.requirements.substring(0, 40));
    const outputDir = options.outputDir || 'tests/generated';
    const filePath = await saveTestFile(cleanCode, `${name}.spec.ts`, outputDir);
    const testNames = this.extractTestNames(cleanCode);
    return { filePath, testCount: testNames.length, testNames };
  }

  async generate(options: GenerationOptions): Promise<GeneratedTest> {
    if (options.url && options.requirements) {
      const analysis = await this.analyzer.analyze(options.url);
      const prompt = this.buildCombinedPrompt(analysis, options);
      const code = await this.claude.complete(prompt, { system: SYSTEM_PROMPT });
      const cleanCode = this.cleanCode(code);
      const name = options.testName || slugify(analysis.title || 'combined');
      const outputDir = options.outputDir || 'tests/generated';
      const filePath = await saveTestFile(cleanCode, `${name}.spec.ts`, outputDir);
      const testNames = this.extractTestNames(cleanCode);
      return { filePath, testCount: testNames.length, testNames };
    }
    if (options.url) return this.generateFromURL(options);
    if (options.requirements) return this.generateFromRequirements(options);
    throw new Error('Either url or requirements must be provided');
  }

  private buildURLPrompt(analysis: PageAnalysis, options: GenerationOptions): string {
    return `Generate a Playwright TypeScript test suite for: ${analysis.url}
Title: ${analysis.title}
Forms: ${JSON.stringify(analysis.forms.slice(0,3))}
Buttons: ${JSON.stringify(analysis.buttons.slice(0,10))}
Generate up to ${options.maxTests || 10} meaningful test cases covering navigation, form validation, error states.`;
  }

  private buildRequirementsPrompt(options: GenerationOptions): string {
    return `Generate a Playwright TypeScript test suite based on:
BASE URL: ${process.env.BASE_URL || 'http://localhost:3000'}
REQUIREMENTS: ${options.requirements}
Cover happy path, edge cases, and negative scenarios.`;
  }

  private buildCombinedPrompt(analysis: PageAnalysis, options: GenerationOptions): string {
    return `Generate Playwright TypeScript tests from both live page and requirements.
PAGE: ${JSON.stringify({ title: analysis.title, forms: analysis.forms })}
REQUIREMENTS: ${options.requirements}`;
  }

  private cleanCode(raw: string): string {
    return raw.replace(/^```(?:typescript|ts)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }

  private extractTestNames(code: string): string[] {
    const matches = code.match(/test\(['`"](.+?)['`"]/g) || [];
    return matches.map(m => m.replace(/test\(['`"]/, '').replace(/['`"]$/, ''));
  }
}
