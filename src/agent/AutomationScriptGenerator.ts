import * as path from 'path';
import * as fs from 'fs-extra';
import { ClaudeClient } from '../utils/ClaudeClient';
import { ManualTestSuite, ManualTestCase } from './ManualTestGenerator';
import { AIMobileTester } from './AIMobileTester';
import { saveTestFile, slugify } from '../utils/FileUtils';
import { logger } from '../utils/Logger';

export type AutomationTarget = 'ui' | 'api' | 'mobile';

export interface AutomationBundle {
  ui?: AutomationScript;
  api?: AutomationScript;
  mobile?: AutomationScript;
  generatedAt: string;
  sourceManualSuiteId: string;
}

export interface AutomationScript {
  target: AutomationTarget;
  filePath: string;
  testCount: number;
  testNames: string[];
  sourceTestIds: string[];    // which manual TC IDs this covers
}

export interface GenerateAutomationOptions {
  suite: ManualTestSuite;
  targets?: AutomationTarget[];   // defaults to ['ui', 'api', 'mobile']
  outputDir?: string;
  baseURL?: string;
  apiBaseURL?: string;
}

const UI_SYSTEM = `You are an expert Playwright TypeScript automation engineer.
Generate production-ready, maintainable E2E UI test suites.
Rules:
- Use semantic locators: getByRole, getByLabel, getByPlaceholder, getByTestId, getByText
- Never use CSS selectors or XPath unless absolutely necessary
- Use Page Object Model for any page with 4+ interactions
- Every test must use test.describe() grouping and descriptive names
- Include beforeEach for navigation and afterEach for cleanup where needed
- Await all async calls. Use expect() after every meaningful action.
- Use data-testid attributes for key elements (they are present in the app)
- Output ONLY valid TypeScript. No markdown fences. No explanations.`;

const API_SYSTEM = `You are an expert API test automation engineer using Playwright's APIRequestContext.
Generate thorough REST API tests.
Rules:
- Use test.use({ baseURL }) at the top
- Test success paths (2xx), client errors (4xx), auth errors (401/403)
- Validate response body schema and key fields with expect()
- Handle auth tokens properly — get token in beforeAll, reuse in tests
- Use test.describe() for logical grouping
- Output ONLY valid TypeScript. No markdown fences. No explanations.`;


export class AutomationScriptGenerator {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Generate automation scripts (UI, API, Mobile) from an approved ManualTestSuite.
   * Only uses test cases with status === 'approved'.
   */
  async generate(options: GenerateAutomationOptions): Promise<AutomationBundle> {
    const {
      suite,
      targets = ['ui', 'api', 'mobile'],
      outputDir = 'tests/generated',
      baseURL = process.env.BASE_URL || 'http://localhost:3000',
      apiBaseURL = process.env.API_BASE_URL || 'http://localhost:3001',
    } = options;

    const approvedTests = suite.testCases.filter((t) => t.status === 'approved');
    if (approvedTests.length === 0) {
      throw new Error('No approved test cases found in suite. Run QA review first.');
    }

    logger.info(
      `🤖 Generating automation scripts for ${approvedTests.length} approved tests ` +
      `[${targets.join(', ')}] → ${outputDir}`
    );

    const bundle: AutomationBundle = {
      generatedAt: new Date().toISOString(),
      sourceManualSuiteId: suite.suiteId,
    };

    // Generate all targets in parallel
    const tasks: Promise<void>[] = [];

    if (targets.includes('ui')) {
      tasks.push(
        this.generateUI(approvedTests, suite, outputDir, baseURL).then((s) => { bundle.ui = s; })
      );
    }
    if (targets.includes('api')) {
      tasks.push(
        this.generateAPI(approvedTests, suite, outputDir, apiBaseURL).then((s) => { bundle.api = s; })
      );
    }
    if (targets.includes('mobile')) {
      tasks.push(
        this.generateMobile(approvedTests, suite, outputDir, baseURL).then((s) => { bundle.mobile = s; })
      );
    }

    await Promise.all(tasks);

    // Save bundle manifest
    const manifestPath = path.join(outputDir, `automation-bundle-${suite.suiteId}.json`);
    await fs.ensureDir(outputDir);
    await fs.writeJson(manifestPath, bundle, { spaces: 2 });
    logger.info(`✅ Automation bundle manifest → ${manifestPath}`);

    return bundle;
  }

  // ─── UI Tests ─────────────────────────────────────────────────────────────

  private async generateUI(
    testCases: ManualTestCase[],
    suite: ManualTestSuite,
    outputDir: string,
    baseURL: string
  ): Promise<AutomationScript> {
    const uiTests = testCases.filter((t) => ['functional', 'negative', 'edge-case', 'ui'].includes(t.type));
    logger.info(`  🖥️  Generating UI automation for ${uiTests.length} test cases`);

    const prompt = `
Generate a Playwright TypeScript E2E test suite for the following approved manual test cases.

BASE URL: ${baseURL}
COMPONENT: ${suite.component}

MANUAL TEST CASES TO AUTOMATE:
${JSON.stringify(uiTests.slice(0, 6).map((t) => ({ id: t.id, title: t.title, type: t.type, steps: t.steps })), null, 2)}

Instructions:
- Each manual test case should become one or more Playwright test() functions
- Reference the manual test ID in a comment above each test: // TC-001
- Use data-testid attributes: email-input, password-input, login-btn, login-error,
  task-list, add-task-btn, task-card, task-title, task-complete-btn, task-edit-btn,
  task-delete-btn, logout-btn, task-form, title-input, description-input,
  priority-select, due-date-input, save-task-btn, cancel-btn
- The app has routes: / (redirects to /login), /login, /dashboard
- Test user credentials: email=test@example.com, password=Test123!
- Use Page Object Model — create a LoginPage and DashboardPage class

Output ONLY the TypeScript file. No markdown. No explanations.
`.trim();

    const code = await this.claude.complete(prompt, { system: UI_SYSTEM, maxTokens: 8192 });
    const clean = this.cleanCode(code);
    const slug = slugify(suite.component);
    const filePath = await saveTestFile(clean, `${slug}-ui.spec.ts`, outputDir);
    const testNames = this.extractTestNames(clean);

    return {
      target: 'ui',
      filePath,
      testCount: testNames.length,
      testNames,
      sourceTestIds: uiTests.map((t) => t.id),
    };
  }

  // ─── API Tests ────────────────────────────────────────────────────────────

  private async generateAPI(
    testCases: ManualTestCase[],
    suite: ManualTestSuite,
    outputDir: string,
    apiBaseURL: string
  ): Promise<AutomationScript> {
    const apiTests = testCases.filter((t) => t.type === 'api' || t.tags.some((tag) => ['api', 'rest', 'endpoint'].includes(tag)));
    // If no explicit API tests, generate API coverage from all approved tests
    const targetTests = apiTests.length > 0 ? apiTests : testCases.slice(0, 8);
    logger.info(`  🌐 Generating API automation for ${targetTests.length} test cases`);

    const prompt = `
Generate a Playwright TypeScript API test suite using APIRequestContext.

API BASE URL: ${apiBaseURL}
COMPONENT: ${suite.component}

API ENDPOINTS (Task Manager app):
- POST /api/auth/register — { email, password, name } → 201 { user, token }
- POST /api/auth/login — { email, password } → 200 { user, token }
- POST /api/auth/logout — (auth header) → 200
- GET /api/tasks — (auth header) → 200 [{ id, title, description, priority, dueDate, completed }]
- POST /api/tasks — (auth header) { title, description, priority, dueDate } → 201 task
- GET /api/tasks/:id — (auth header) → 200 task
- PUT /api/tasks/:id — (auth header) { ...fields } → 200 task
- DELETE /api/tasks/:id — (auth header) → 204
- PATCH /api/tasks/:id/complete — (auth header) → 200 task

MANUAL TEST CASES FOR CONTEXT:
${JSON.stringify(targetTests.slice(0, 6), null, 2)}

Instructions:
- Use test.use({ baseURL: '${apiBaseURL}' }) at the top
- Get auth token in beforeAll by calling POST /api/auth/login
- Test all CRUD operations, auth failures, validation errors
- Check response status codes AND body structure
- Reference manual test IDs in comments: // TC-005

Output ONLY the TypeScript file. No markdown. No explanations.
`.trim();

    const code = await this.claude.complete(prompt, { system: API_SYSTEM, maxTokens: 8192 });
    const clean = this.cleanCode(code);
    const slug = slugify(suite.component);
    const filePath = await saveTestFile(clean, `${slug}-api.spec.ts`, outputDir);
    const testNames = this.extractTestNames(clean);

    return {
      target: 'api',
      filePath,
      testCount: testNames.length,
      testNames,
      sourceTestIds: targetTests.map((t) => t.id),
    };
  }

  // ─── Mobile Tests — delegates to AIMobileTester ──────────────────────────

  private async generateMobile(
    testCases: ManualTestCase[],
    suite: ManualTestSuite,
    outputDir: string,
    baseURL: string
  ): Promise<AutomationScript> {
    logger.info(`  📱 Delegating mobile generation to AIMobileTester`);

    const mobileTester = new AIMobileTester();
    const result = await mobileTester.generate({
      url: baseURL,
      suite,
      devices: ['iPhone 13', 'Pixel 5', 'iPad Mini'],
      scenarios: ['layout', 'navigation', 'touch', 'orientation', 'network', 'performance', 'forms'],
      outputDir,
      testName: `${slugify(suite.component)}-mobile`,
    });

    return {
      target: 'mobile',
      filePath: result.filePath,
      testCount: result.testCount,
      testNames: result.testNames,
      sourceTestIds: testCases.map((t) => t.id),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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
