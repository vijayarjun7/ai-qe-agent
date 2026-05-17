#!/usr/bin/env ts-node
/**
 * eval_suite.ts — LLM Evaluation Suite for AI QE Agent
 *
 * Five evaluators using the LLM-as-judge pattern (Claude evaluates Claude):
 *   1. OutputQualityScorer          — completeness, specificity, actionability (0-1)
 *   2. HallucinationDetector        — claims not grounded in input context
 *   3. PromptFaithfulnessChecker    — instruction-following audit
 *   4. AgentChainConsistencyChecker — cross-agent output→input compatibility
 *   5. EvalReportGenerator          — runs all 4 on sample pipeline, writes JSON + table
 *
 * Run:  npx ts-node eval_suite.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ClaudeClient } from './src/utils/ClaudeClient';

dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface QualityScore {
  completeness: number;
  specificity: number;
  actionability: number;
  overall: number;
  reasoning: string;
}

export interface HallucinationResult {
  hallucination_detected: boolean;
  suspicious_claims: string[];
  reasoning: string;
}

export interface FaithfulnessResult {
  followed_instructions: boolean;
  missed_instructions: string[];
  reasoning: string;
}

export interface ChainConsistencyResult {
  compatible: boolean;
  issues: string[];
  reasoning: string;
}

export interface EvalEntry {
  agent: string;
  description: string;
  quality_score: QualityScore;
  hallucination: HallucinationResult;
  faithfulness: FaithfulnessResult;
  chain_consistency?: ChainConsistencyResult;
}

export interface EvalReport {
  report_id: string;
  timestamp: string;
  model_under_evaluation: string;
  evaluator_model: string;
  evaluations: EvalEntry[];
  summary: {
    total_agents_evaluated: number;
    avg_completeness: number;
    avg_specificity: number;
    avg_actionability: number;
    avg_overall_quality: number;
    hallucinations_detected: number;
    faithfulness_failures: number;
    chain_consistency_failures: number;
  };
}

// Internal type for sample pipeline data
interface SampleEntry {
  agent: string;
  taskDescription: string;
  inputContext: string;
  prompt: string;
  output: string;
  chainCheck?: {
    nextAgent: string;
    expectedInputOfNext: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Output Quality Scorer
// ═══════════════════════════════════════════════════════════════════════════════

export class OutputQualityScorer {
  private readonly SYSTEM = `You are an LLM output quality judge evaluating AI-generated responses in a software QE (Quality Engineering) pipeline.

Score the response on three dimensions, each from 0.0 to 1.0:
- completeness:  Does the response address ALL aspects of the task? 1.0 = fully complete, 0.0 = barely started.
- specificity:   Is the response concrete and detailed vs. vague/generic? 1.0 = highly specific with real values, 0.0 = generic platitudes.
- actionability: Can an engineer act on this output immediately without guessing? 1.0 = immediately actionable, 0.0 = cannot act on it.

Compute overall as weighted average: (completeness × 0.35) + (specificity × 0.35) + (actionability × 0.30). Round to 2 decimal places.

Output ONLY a valid JSON object — no markdown fences, no prose outside JSON:
{"completeness":0.00,"specificity":0.00,"actionability":0.00,"overall":0.00,"reasoning":"one concise sentence explaining the scores"}`;

  constructor(private claude: ClaudeClient) {}

  async score(agentResponse: string, taskDescription: string): Promise<QualityScore> {
    const prompt = `TASK DESCRIPTION (what the agent was asked to produce):
${taskDescription}

AGENT RESPONSE (what the agent actually produced):
${agentResponse.substring(0, 3500)}

Score this response on completeness, specificity, and actionability.`;

    const raw = await this.claude.complete(prompt, {
      system: this.SYSTEM,
      maxTokens: 300,
    });

    return this.claude.parseJSON<QualityScore>(raw);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Hallucination Detector
// ═══════════════════════════════════════════════════════════════════════════════

export class HallucinationDetector {
  private readonly SYSTEM = `You are a hallucination detector for AI-generated QE pipeline outputs.

A hallucination is a specific, falsifiable claim in the OUTPUT that is NOT grounded in the INPUT CONTEXT:
- Names a function, file, URL, selector, user, field, or value absent from the input
- Contradicts a fact stated in the input context
- Invents test IDs, API endpoints, component names, or error messages not mentioned in input

Do NOT flag:
- General best-practice recommendations (e.g. "use descriptive names")
- Reasonable inferences directly implied by stated requirements
- Standard QA terminology and patterns

Output ONLY valid JSON — no markdown, no prose:
{"hallucination_detected":false,"suspicious_claims":[],"reasoning":"one concise sentence"}`;

  constructor(private claude: ClaudeClient) {}

  async detect(inputContext: string, agentOutput: string): Promise<HallucinationResult> {
    const prompt = `INPUT CONTEXT (everything the agent was given as input):
${inputContext.substring(0, 2500)}

AGENT OUTPUT (what the agent produced):
${agentOutput.substring(0, 2500)}

Identify any claims in the output that are not supported by the input context.`;

    const raw = await this.claude.complete(prompt, {
      system: this.SYSTEM,
      maxTokens: 400,
    });

    return this.claude.parseJSON<HallucinationResult>(raw);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Prompt Faithfulness Checker
// ═══════════════════════════════════════════════════════════════════════════════

export class PromptFaithfulnessChecker {
  private readonly SYSTEM = `You are an instruction-following auditor for a multi-agent AI QE system.

Given an ORIGINAL PROMPT and the AI RESPONSE, audit whether the response followed every explicit instruction.

An instruction is "missed" if the prompt clearly said to do X and the response did not do X.
Examples of missed instructions: "output only JSON" but response has prose; "include 3 functional tests" but only 1 is present; "no markdown fences" but response uses them.

Do NOT penalize for:
- Minor stylistic variations that don't violate the instruction
- Instructions that are ambiguous or open to interpretation

Output ONLY valid JSON — no markdown, no prose:
{"followed_instructions":true,"missed_instructions":[],"reasoning":"one concise sentence"}`;

  constructor(private claude: ClaudeClient) {}

  async check(originalPrompt: string, response: string): Promise<FaithfulnessResult> {
    const prompt = `ORIGINAL PROMPT:
${originalPrompt.substring(0, 2000)}

AI RESPONSE:
${response.substring(0, 2500)}

Did the AI response follow every explicit instruction in the prompt?`;

    const raw = await this.claude.complete(prompt, {
      system: this.SYSTEM,
      maxTokens: 400,
    });

    return this.claude.parseJSON<FaithfulnessResult>(raw);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Agent Chain Consistency Checker
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentChainConsistencyChecker {
  private readonly SYSTEM = `You are a pipeline compatibility inspector for a multi-agent AI QE system.

Given the OUTPUT of Agent A and the EXPECTED INPUT FORMAT of Agent B, determine:
1. Are they compatible? Can Agent B consume Agent A's output without data transformation errors?
2. What specific issues exist? (schema mismatches, missing required fields, wrong data types, unexpected format)

Focus on concrete structural issues — field names, required keys, data types, format (JSON vs plain text), array vs object.

Output ONLY valid JSON — no markdown, no prose:
{"compatible":true,"issues":[],"reasoning":"one concise sentence"}`;

  constructor(private claude: ClaudeClient) {}

  async check(
    agentAOutput: string,
    agentBExpectedInput: string,
    agentAName: string,
    agentBName: string,
  ): Promise<ChainConsistencyResult> {
    const prompt = `AGENT A (${agentAName}) OUTPUT:
${agentAOutput.substring(0, 2000)}

AGENT B (${agentBName}) EXPECTED INPUT FORMAT / Schema:
${agentBExpectedInput.substring(0, 1500)}

Can Agent B directly consume Agent A's output? List any compatibility issues.`;

    const raw = await this.claude.complete(prompt, {
      system: this.SYSTEM,
      maxTokens: 400,
    });

    return this.claude.parseJSON<ChainConsistencyResult>(raw);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Eval Report Generator
// ═══════════════════════════════════════════════════════════════════════════════

export class EvalReportGenerator {
  private scorer: OutputQualityScorer;
  private hallucinationDetector: HallucinationDetector;
  private faithfulnessChecker: PromptFaithfulnessChecker;
  private chainChecker: AgentChainConsistencyChecker;

  constructor() {
    const client = new ClaudeClient();
    this.scorer = new OutputQualityScorer(client);
    this.hallucinationDetector = new HallucinationDetector(client);
    this.faithfulnessChecker = new PromptFaithfulnessChecker(client);
    this.chainChecker = new AgentChainConsistencyChecker(client);
  }

  async run(): Promise<EvalReport> {
    this.printBanner();

    const samples = this.getSamplePipelineRun();
    const evaluations: EvalEntry[] = [];

    for (const sample of samples) {
      process.stdout.write(`  ► Evaluating ${sample.agent}...`);

      // Run quality, hallucination, and faithfulness checks in parallel
      const [quality, hallucination, faithfulness] = await Promise.all([
        this.scorer.score(sample.output, sample.taskDescription),
        this.hallucinationDetector.detect(sample.inputContext, sample.output),
        this.faithfulnessChecker.check(sample.prompt, sample.output),
      ]);

      const entry: EvalEntry = {
        agent: sample.agent,
        description: sample.taskDescription,
        quality_score: quality,
        hallucination,
        faithfulness,
      };

      // Chain consistency check runs after (depends on previous agent's output)
      if (sample.chainCheck) {
        entry.chain_consistency = await this.chainChecker.check(
          sample.output,
          sample.chainCheck.expectedInputOfNext,
          sample.agent,
          sample.chainCheck.nextAgent,
        );
      }

      evaluations.push(entry);
      process.stdout.write(` done (overall: ${quality.overall.toFixed(2)})\n`);
    }

    const report = this.buildReport(evaluations);
    const reportPath = this.saveReport(report);
    this.printSummaryTable(report, reportPath);

    return report;
  }

  // ─── Sample Pipeline Run Data ──────────────────────────────────────────────
  // Realistic snapshots of what each agent actually receives and produces.

  private getSamplePipelineRun(): SampleEntry[] {
    const manualTestOutput = JSON.stringify(
      [
        {
          id: 'TC-001',
          component: 'Login',
          title: 'Successful login with valid credentials',
          description: 'Verify a registered user can log in and reach the dashboard',
          type: 'functional',
          priority: 'P0',
          preconditions: ['User is registered with email user@example.com and password Password123!'],
          steps: [
            { stepNumber: 1, action: 'Navigate to http://localhost:3000/login', expectedOutcome: 'Login form is visible with email, password fields and Sign In button' },
            { stepNumber: 2, action: 'Enter user@example.com in the email field', expectedOutcome: 'Field accepts input' },
            { stepNumber: 3, action: 'Enter Password123! in the password field', expectedOutcome: 'Field accepts input, characters are masked' },
            { stepNumber: 4, action: 'Click the Sign In button', expectedOutcome: 'Page redirects to /dashboard within 2s' },
          ],
          expectedResult: 'User is authenticated and the dashboard task list is displayed',
          acceptanceCriteria: ['JWT token stored in localStorage', 'Dashboard loads within 2 seconds', 'Task list component visible'],
          tags: ['auth', 'smoke', 'P0'],
          status: 'draft',
        },
        {
          id: 'TC-002',
          component: 'Login',
          title: 'Login rejected with incorrect password',
          description: 'Verify the system rejects login with a wrong password and shows an error',
          type: 'negative',
          priority: 'P0',
          preconditions: ['User is registered'],
          steps: [
            { stepNumber: 1, action: 'Navigate to /login', expectedOutcome: 'Login form visible' },
            { stepNumber: 2, action: 'Enter user@example.com and type WrongPass! as password', expectedOutcome: 'Fields populated' },
            { stepNumber: 3, action: 'Click Sign In', expectedOutcome: 'Error message "Invalid credentials" appears, no redirect' },
          ],
          expectedResult: 'Error message displayed, user remains on login page, no token stored',
          acceptanceCriteria: ['No JWT token stored', 'Error message visible within 1s', 'Form fields remain editable'],
          tags: ['auth', 'negative', 'P0'],
          status: 'draft',
        },
        {
          id: 'TC-003',
          component: 'TaskCRUD',
          title: 'Create a new task with all fields populated',
          description: 'Verify a logged-in user can create a task with title, description, priority, and due date',
          type: 'functional',
          priority: 'P0',
          preconditions: ['User is logged in and on the dashboard'],
          steps: [
            { stepNumber: 1, action: 'Click the Add Task button', expectedOutcome: 'Task creation form opens as a modal' },
            { stepNumber: 2, action: 'Enter "Deploy backend" in the title field', expectedOutcome: 'Title field shows "Deploy backend"' },
            { stepNumber: 3, action: 'Select "high" from the priority dropdown', expectedOutcome: 'Priority shows "high"' },
            { stepNumber: 4, action: 'Set due date to 2026-06-01', expectedOutcome: 'Due date field shows 2026-06-01' },
            { stepNumber: 5, action: 'Click Save', expectedOutcome: 'Modal closes, task appears in the task list' },
          ],
          expectedResult: 'New task "Deploy backend" is visible in the dashboard task list with correct priority and due date',
          acceptanceCriteria: ['Task persists after page refresh', 'All fields saved correctly in the database', 'Task card shows priority badge'],
          tags: ['crud', 'smoke', 'P0'],
          status: 'draft',
        },
        {
          id: 'TC-004',
          component: 'TaskCRUD',
          title: 'Delete a task removes it from the list',
          description: 'Verify deleting a task removes it from the UI and database',
          type: 'functional',
          priority: 'P1',
          preconditions: ['User is logged in', 'At least one task exists in the list'],
          steps: [
            { stepNumber: 1, action: 'Click the Delete button on an existing task card', expectedOutcome: 'Confirmation dialog appears' },
            { stepNumber: 2, action: 'Confirm deletion', expectedOutcome: 'Task disappears from the task list' },
          ],
          expectedResult: 'Task is removed from the UI and database permanently',
          acceptanceCriteria: ['Task no longer appears after refresh', 'DELETE /api/tasks/:id returns 200'],
          tags: ['crud', 'P1'],
          status: 'draft',
        },
        {
          id: 'TC-005',
          component: 'API',
          title: 'POST /api/tasks creates a task and returns 201',
          description: 'Verify the tasks API endpoint accepts valid JSON and returns the created task',
          type: 'api',
          priority: 'P0',
          preconditions: ['Valid JWT token available'],
          steps: [
            { stepNumber: 1, action: 'Send POST /api/tasks with body {"title":"API task","priority":"low","dueDate":"2026-06-01"}', expectedOutcome: 'HTTP 201 response with task object including generated id' },
          ],
          expectedResult: 'Response: 201 Created, body contains task with id, title, priority, dueDate, status="pending"',
          acceptanceCriteria: ['Status code 201', 'Response body matches request fields', 'id field is a non-empty string'],
          tags: ['api', 'P0'],
          status: 'draft',
        },
      ],
      null,
      2,
    );

    const qaReviewOutput = JSON.stringify(
      {
        overallVerdict: 'approved',
        coverageScore: 84,
        qualityScore: 81,
        approvedTestIds: ['TC-001', 'TC-002', 'TC-003', 'TC-004', 'TC-005'],
        flaggedTestIds: [],
        coverageGaps: [
          'No edge-case test for 255-character task title boundary',
          'Missing negative test for expired or tampered JWT',
          'No test for concurrent task creation by two users',
          'Mobile responsive layout not covered by any test case',
        ],
        recommendations: [
          'Add TC-006: boundary test for maximum title length (255 chars)',
          'Add TC-007: expired JWT should return 401 on all protected endpoints',
          'Consider a mobile viewport test for the task list on 375px width',
        ],
      },
      null,
      2,
    );

    const automationOutput = `import { test, expect } from '@playwright/test';

test.describe('Login — UI Automation (TC-001, TC-002)', () => {
  test('TC-001: Successful login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('Password123!');
    await page.getByTestId('login-btn').click();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByTestId('task-list')).toBeVisible();
  });

  test('TC-002: Login rejected with incorrect password', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('WrongPass!');
    await page.getByTestId('login-btn').click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
  });
});

test.describe('TaskCRUD — UI Automation (TC-003)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('Password123!');
    await page.getByTestId('login-btn').click();
    await expect(page).toHaveURL('/dashboard');
  });

  test('TC-003: Create a new task with all fields populated', async ({ page }) => {
    await page.getByTestId('add-task-btn').click();
    await expect(page.getByTestId('task-form')).toBeVisible();
    await page.getByTestId('title-input').fill('Deploy backend');
    await page.getByTestId('priority-select').selectOption('high');
    await page.getByTestId('due-date-input').fill('2026-06-01');
    await page.getByTestId('save-task-btn').click();
    await expect(page.getByTestId('task-list')).toContainText('Deploy backend');
  });
});`;

    const selfHealingOutput = `import { test, expect } from '@playwright/test';

test.describe('Login — UI Automation (TC-001, TC-002) [HEALED]', () => {
  test('TC-001: Successful login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('Password123!');
    await page.getByTestId('login-btn').click();
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByTestId('task-list')).toBeVisible();
  });

  test('TC-002: Login rejected with incorrect password', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('WrongPass!');
    await page.getByTestId('login-btn').click();
    await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
  });
});`;

    return [
      {
        agent: 'ManualTestGenerator',
        taskDescription:
          'Generate 8 manual test cases for a TaskMaster app covering Login (functional + negative), Task CRUD, API endpoint, and mobile layout. Each case must have step-by-step actions with expected outcomes, acceptance criteria, and priority labels.',
        inputContext:
          'App: TaskMaster — full-stack Task Manager with JWT auth, task CRUD (title, description, priority, due date, status), filter by status/priority, mobile-responsive layout. API: /api/auth (register, login) and /api/tasks (CRUD). Database: SQLite with users and tasks tables. Frontend: React. Backend: Express + Node.js.',
        prompt: `Generate a SAMPLE set of 8 manual test cases (representative, not exhaustive). Cover: Login, Task CRUD, Mobile layout, API.

Return a JSON array. Each item must have these fields:
{"id":"TC-001","component":"Login","title":"...","description":"...","type":"functional","priority":"P0","preconditions":["..."],"steps":[{"stepNumber":1,"action":"...","expectedOutcome":"..."}],"expectedResult":"...","acceptanceCriteria":["..."],"tags":["..."],"status":"draft"}

Types allowed: functional | negative | edge-case | ui | api | mobile
Priorities: P0 | P1 | P2
Distribution: 3 functional, 2 negative, 1 edge-case, 1 api, 1 mobile
Output ONLY the JSON array. No prose. No markdown fences.`,
        output: manualTestOutput,
        chainCheck: {
          nextAgent: 'QAReviewAgent',
          expectedInputOfNext: `QAReviewAgent.reviewManualTests() accepts a ManualTestSuite object:
{
  suiteId: string,
  suiteName: string,
  component: string,
  requirementsRef: string,
  generatedAt: string,          // ISO timestamp
  testCases: Array<{
    id: string,                 // e.g. "TC-001"
    component: string,
    title: string,
    description: string,
    type: "functional" | "negative" | "edge-case" | "ui" | "api" | "mobile",
    priority: "P0" | "P1" | "P2",
    preconditions: string[],
    steps: Array<{ stepNumber: number, action: string, expectedOutcome: string }>,
    expectedResult: string,
    acceptanceCriteria: string[],
    tags: string[],
    status: "draft" | "approved" | "flagged-for-review",
    generatedAt: string
  }>,
  coverageSummary: { functional: number, negative: number, edgeCases: number, ui: number, api: number, mobile: number }
}`,
        },
      },

      {
        agent: 'QAReviewAgent',
        taskDescription:
          'Peer-review the ManualTestGenerator output: assess coverage quality, identify gaps, score coverage (0-100) and quality (0-100), return a structured review verdict with approved/flagged test IDs and actionable recommendations.',
        inputContext:
          'Input: ManualTestSuite with 5 test cases — TC-001 (Login success/functional/P0), TC-002 (Login fail/negative/P0), TC-003 (Create task/functional/P0), TC-004 (Delete task/functional/P1), TC-005 (POST /api/tasks/api/P0). Requirements cover: JWT auth, full CRUD, priority/status filtering, mobile layout, REST API.',
        prompt: `You are a Senior QA Lead performing peer review of a generated manual test suite.

Review the suite and produce a structured review containing:
- overallVerdict: "approved" | "needs-revision" | "rejected"
- coverageScore: integer 0-100 (how well the suite covers the stated requirements)
- qualityScore: integer 0-100 (clarity, completeness, executability of individual test cases)
- approvedTestIds: string[] (test IDs that pass review)
- flaggedTestIds: string[] (test IDs that need revision)
- coverageGaps: string[] (requirements not covered by any test case)
- recommendations: string[] (specific, actionable improvements)

Output ONLY valid JSON. No markdown. No prose.`,
        output: qaReviewOutput,
        chainCheck: {
          nextAgent: 'AutomationScriptGenerator',
          expectedInputOfNext: `AutomationScriptGenerator.generate() expects:
{
  suite: ManualTestSuite,         // testCases[].status must be "approved" or "draft"
  targets: Array<"ui" | "api" | "mobile">,
  outputDir: string,
  baseURL: string,                // e.g. "http://localhost:3000"
  apiBaseURL: string              // e.g. "http://localhost:3001/api"
}
It reads suite.testCases[] and generates Playwright .spec.ts files.
Required fields per test case: id, title, type, steps[].action, steps[].expectedOutcome, expectedResult.`,
        },
      },

      {
        agent: 'AutomationScriptGenerator',
        taskDescription:
          'Convert approved manual test cases (TC-001 Login success, TC-002 Login fail, TC-003 Create task) into runnable Playwright TypeScript automation scripts. Use data-testid selectors, proper async/await patterns, beforeEach login setup where needed.',
        inputContext:
          'Approved test cases: TC-001 (login success → navigate /login, fill email-input, fill password-input, click login-btn, expect /dashboard and task-list visible), TC-002 (login fail → same steps, wrong password, expect login-error visible), TC-003 (create task → login first, click add-task-btn, fill title-input, select priority-select, fill due-date-input, click save-task-btn, expect task-list contains title). App at http://localhost:3000. DOM uses data-testid attributes.',
        prompt: `Convert these manual test cases into Playwright TypeScript automation scripts.

Requirements:
- Import from @playwright/test
- Use data-testid selectors via page.getByTestId()
- Use async/await throughout
- Group related tests with test.describe()
- Use test.beforeEach() for shared login setup where multiple tests need authentication
- Include meaningful expect assertions matching the test case acceptance criteria
- Output a complete, runnable .spec.ts file — no partial snippets
- No markdown fences. No explanatory prose. Output only the TypeScript file.`,
        output: automationOutput,
      },

      {
        agent: 'SelfHealingAgent',
        taskDescription:
          'Detect and repair 3 broken Playwright selectors — getByTestId("btn-login-v2"), getByTestId("user-email-field"), getByTestId("tasks-container-main") — by replacing them with the correct data-testid values from the live DOM: login-btn, email-input, task-list.',
        inputContext: `Broken test file selectors (data-testid values that no longer exist):
  1. getByTestId("btn-login-v2")         → was renamed during UI refactor
  2. getByTestId("user-email-field")     → changed to match design system naming
  3. getByTestId("tasks-container-main") → updated in new component structure

Live DOM source of truth (data-testid values that exist):
  login-form, email-input, password-input, login-error, login-btn (login page)
  add-task-btn, task-list, task-card, task-title, task-complete-btn, task-edit-btn, task-delete-btn, logout-btn (dashboard)
  task-form, title-input, description-input, priority-select, due-date-input, save-task-btn, cancel-btn (task form)`,
        prompt: `You are a Playwright self-healing agent. The test file has 3 broken getByTestId selectors whose data-testid values no longer exist in the app's HTML.

Broken selectors to fix:
1. getByTestId("btn-login-v2")         → correct selector from DOM
2. getByTestId("user-email-field")     → correct selector from DOM
3. getByTestId("tasks-container-main") → correct selector from DOM

Instructions:
- Replace ONLY the broken data-testid selectors with correct ones from the provided DOM
- Do not change any other code (assertions, logic, test structure)
- Return the complete corrected TypeScript file
- No markdown fences. No explanations. Output only the TypeScript.`,
        output: selfHealingOutput,
      },
    ];
  }

  // ─── Build report object ───────────────────────────────────────────────────

  private buildReport(evaluations: EvalEntry[]): EvalReport {
    const n = evaluations.length;
    const avgOf = (key: keyof QualityScore) =>
      parseFloat(
        (evaluations.reduce((sum, e) => sum + (e.quality_score[key] as number), 0) / n).toFixed(3),
      );

    return {
      report_id: `EVAL-${Date.now()}`,
      timestamp: new Date().toISOString(),
      model_under_evaluation: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      evaluator_model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      evaluations,
      summary: {
        total_agents_evaluated: n,
        avg_completeness: avgOf('completeness'),
        avg_specificity: avgOf('specificity'),
        avg_actionability: avgOf('actionability'),
        avg_overall_quality: avgOf('overall'),
        hallucinations_detected: evaluations.filter((e) => e.hallucination.hallucination_detected)
          .length,
        faithfulness_failures: evaluations.filter((e) => !e.faithfulness.followed_instructions)
          .length,
        chain_consistency_failures: evaluations.filter(
          (e) => e.chain_consistency && !e.chain_consistency.compatible,
        ).length,
      },
    };
  }

  // ─── Save report to disk ───────────────────────────────────────────────────

  private saveReport(report: EvalReport): string {
    const dir = path.resolve('eval_reports');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `report_${timestamp}.json`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');
    return filepath;
  }

  // ─── Console summary table ─────────────────────────────────────────────────

  private printBanner(): void {
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║          AI QE AGENT — LLM EVALUATION SUITE                     ║');
    console.log('║          LLM-as-Judge  •  Claude evaluates Claude               ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');
    console.log('  Running 4 evaluators across 4 pipeline agents...\n');
  }

  private printSummaryTable(report: EvalReport, savedPath: string): void {
    const TOTAL_W = 94;
    const heavy = '═'.repeat(TOTAL_W);
    const light = '─'.repeat(TOTAL_W);

    const pad = (s: string, w: number) => s.slice(0, w).padEnd(w);
    const rpad = (s: string, w: number) => s.slice(0, w).padStart(w);

    console.log('\n' + heavy);
    console.log('  EVALUATION RESULTS');
    console.log(heavy);

    // Header row
    console.log(
      '  ' +
        pad('Agent', 28) +
        rpad('Quality', 8) +
        rpad('Complete', 10) +
        rpad('Specific', 10) +
        rpad('Actionable', 12) +
        pad('  Halluc', 9) +
        pad('Faithful', 10),
    );
    console.log('  ' + light.slice(0, TOTAL_W - 2));

    for (const e of report.evaluations) {
      const q = e.quality_score;
      const fmt = (n: number) => n.toFixed(2);
      const halFlag = e.hallucination.hallucination_detected ? '  ⚠ YES' : '    no';
      const faithFlag = e.faithfulness.followed_instructions ? '    yes' : '  ✗ NO';

      console.log(
        '  ' +
          pad(e.agent, 28) +
          rpad(fmt(q.overall), 8) +
          rpad(fmt(q.completeness), 10) +
          rpad(fmt(q.specificity), 10) +
          rpad(fmt(q.actionability), 12) +
          pad(halFlag, 9) +
          pad(faithFlag, 10),
      );

      if (e.hallucination.suspicious_claims.length > 0) {
        const claims = e.hallucination.suspicious_claims.slice(0, 2).join(' | ');
        console.log(`       Suspicious claims: ${claims}`);
      }
      if (e.faithfulness.missed_instructions.length > 0) {
        const missed = e.faithfulness.missed_instructions.slice(0, 2).join(' | ');
        console.log(`       Missed instructions: ${missed}`);
      }
      if (e.chain_consistency) {
        const cc = e.chain_consistency;
        const chainLine = cc.compatible
          ? 'compatible with next agent'
          : `INCOMPATIBLE: ${cc.issues.slice(0, 1).join(', ')}`;
        console.log(`       Chain → next: ${chainLine}`);
      }
    }

    const s = report.summary;
    console.log('\n  ' + light.slice(0, TOTAL_W - 2));
    console.log(`\n  SUMMARY`);
    console.log(`  ${'Agents evaluated:'.padEnd(30)} ${s.total_agents_evaluated}`);
    console.log(`  ${'Avg overall quality:'.padEnd(30)} ${s.avg_overall_quality.toFixed(3)}`);
    console.log(`  ${'Avg completeness:'.padEnd(30)} ${s.avg_completeness.toFixed(3)}`);
    console.log(`  ${'Avg specificity:'.padEnd(30)} ${s.avg_specificity.toFixed(3)}`);
    console.log(`  ${'Avg actionability:'.padEnd(30)} ${s.avg_actionability.toFixed(3)}`);
    console.log(`  ${'Hallucinations detected:'.padEnd(30)} ${s.hallucinations_detected}`);
    console.log(`  ${'Faithfulness failures:'.padEnd(30)} ${s.faithfulness_failures}`);
    console.log(`  ${'Chain consistency breaks:'.padEnd(30)} ${s.chain_consistency_failures}`);
    console.log(`\n  Report saved → ${savedPath}`);
    console.log('\n' + heavy + '\n');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Entrypoint
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  try {
    const generator = new EvalReportGenerator();
    await generator.run();
  } catch (err: any) {
    console.error(`\n  ERROR: ${err.message}`);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      console.error('  Set ANTHROPIC_API_KEY in your .env file and retry.\n');
    }
    process.exit(1);
  }
}

main();
