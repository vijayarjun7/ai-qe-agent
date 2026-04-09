import * as path from 'path';
import * as fs from 'fs-extra';
import { ClaudeClient } from '../utils/ClaudeClient';
import { logger } from '../utils/Logger';

export interface ManualTestCase {
  id: string;
  component: string;          // e.g. "Login", "TaskCRUD", "MobileResponsive"
  title: string;
  description: string;
  type: 'functional' | 'negative' | 'edge-case' | 'ui' | 'api' | 'mobile';
  priority: 'P0' | 'P1' | 'P2';
  preconditions: string[];
  steps: TestStep[];
  expectedResult: string;
  acceptanceCriteria: string[];
  tags: string[];
  status: 'draft' | 'approved' | 'flagged-for-review';
  generatedAt: string;
}

export interface TestStep {
  stepNumber: number;
  action: string;
  expectedOutcome: string;
}

export interface ManualTestSuite {
  suiteId: string;
  suiteName: string;
  component: string;
  requirementsRef: string;      // path to the requirements file this was generated from
  generatedAt: string;
  testCases: ManualTestCase[];
  coverageSummary: {
    functional: number;
    negative: number;
    edgeCases: number;
    ui: number;
    api: number;
    mobile: number;
  };
}

export interface GenerateManualTestsOptions {
  requirementsPath: string;     // path to REQUIREMENTS.md or a component requirements file
  component?: string;           // which component/area to focus on (or 'all')
  outputDir?: string;
  changedFile?: string;         // set when triggered by a file change
}

const MANUAL_TEST_SYSTEM = `You are a Senior QA Engineer with 10+ years experience writing manual test cases.
You write thorough, unambiguous test cases that a human tester can follow step-by-step.
Your test cases must cover: happy paths, negative scenarios, edge cases, UI/UX checks, and boundary values.
Always output valid JSON — no markdown fences, no prose.`;

export class ManualTestGenerator {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Generate manual test cases from a requirements file.
   * Returns a ManualTestSuite and writes markdown + JSON artifacts to outputDir.
   */
  async generate(options: GenerateManualTestsOptions): Promise<ManualTestSuite> {
    const { requirementsPath, component = 'all', outputDir = 'tests/manual' } = options;

    if (!await fs.pathExists(requirementsPath)) {
      throw new Error(`Requirements file not found: ${requirementsPath}`);
    }

    const requirementsContent = await fs.readFile(requirementsPath, 'utf-8');
    logger.info(`📋 Generating manual test cases for: ${component} from ${requirementsPath}`);

    const prompt = this.buildPrompt(requirementsContent, component, options.changedFile);
    const raw = await this.claude.complete(prompt, {
      system: MANUAL_TEST_SYSTEM,
      maxTokens: 4096,
    });

    const testCases = this.parseTestCases(raw, component);
    const suite = this.buildSuite(testCases, component, requirementsPath);

    await this.saveArtifacts(suite, outputDir);
    logger.info(`✅ Generated ${suite.testCases.length} manual test cases → ${outputDir}`);

    return suite;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private buildPrompt(requirements: string, component: string, changedFile?: string): string {
    // Truncate requirements to ~3000 chars to keep prompt small and fast
    const truncatedReqs = requirements.length > 3000
      ? requirements.substring(0, 3000) + '\n...[truncated for token efficiency]'
      : requirements;

    const focusNote = changedFile
      ? `\nFocus on changes to: ${changedFile}.`
      : '';

    const componentFilter = component !== 'all'
      ? `Focus ONLY on the "${component}" area.`
      : 'Cover: Login, Task CRUD, Mobile layout, API.';

    // NOTE: We generate a representative SAMPLE (8–12 test cases) to keep tokens low.
    // Full coverage generation can be done per-component with --component flag.
    return `
Generate a SAMPLE set of 8 manual test cases (representative, not exhaustive). ${componentFilter}${focusNote}

REQUIREMENTS SUMMARY:
${truncatedReqs}

Return a JSON array. Each item: {"id":"TC-001","component":"Login","title":"...","description":"...","type":"functional","priority":"P0","preconditions":["..."],"steps":[{"stepNumber":1,"action":"...","expectedOutcome":"..."}],"expectedResult":"...","acceptanceCriteria":["..."],"tags":["..."],"status":"draft"}

Types: functional|negative|edge-case|ui|api|mobile. Priorities: P0|P1|P2.
Include: 3 functional, 2 negative, 1 edge-case, 1 api, 1 mobile.
Output ONLY the JSON array. No prose. No markdown.
`.trim();
  }

  private parseTestCases(raw: string, component: string): ManualTestCase[] {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: any[];
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try extracting complete individual JSON objects even if array was truncated
      const objects: any[] = [];
      const objRegex = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/gs;
      let m: RegExpExecArray | null;
      while ((m = objRegex.exec(cleaned)) !== null) {
        try { objects.push(JSON.parse(m[0])); } catch { /* skip malformed */ }
      }
      if (objects.length > 0) {
        logger.warn(`⚠️  JSON array was truncated — recovered ${objects.length} test case object(s)`);
        parsed = objects;
      } else {
        logger.error('Failed to parse manual test cases JSON from Claude response');
        return [];
      }
    }

    const now = new Date().toISOString();
    return parsed.map((tc: any, idx: number) => ({
      id: tc.id || `TC-${String(idx + 1).padStart(3, '0')}`,
      component: tc.component || component,
      title: tc.title || '',
      description: tc.description || '',
      type: tc.type || 'functional',
      priority: tc.priority || 'P1',
      preconditions: tc.preconditions || [],
      steps: (tc.steps || []).map((s: any, i: number) => ({
        stepNumber: s.stepNumber || i + 1,
        action: s.action || '',
        expectedOutcome: s.expectedOutcome || '',
      })),
      expectedResult: tc.expectedResult || '',
      acceptanceCriteria: tc.acceptanceCriteria || [],
      tags: tc.tags || [],
      status: 'draft' as const,
      generatedAt: now,
    }));
  }

  private buildSuite(testCases: ManualTestCase[], component: string, requirementsPath: string): ManualTestSuite {
    const coverage = {
      functional: testCases.filter((t) => t.type === 'functional').length,
      negative: testCases.filter((t) => t.type === 'negative').length,
      edgeCases: testCases.filter((t) => t.type === 'edge-case').length,
      ui: testCases.filter((t) => t.type === 'ui').length,
      api: testCases.filter((t) => t.type === 'api').length,
      mobile: testCases.filter((t) => t.type === 'mobile').length,
    };

    return {
      suiteId: `SUITE-${Date.now()}`,
      suiteName: component === 'all' ? 'Full Application Test Suite' : `${component} Test Suite`,
      component,
      requirementsRef: requirementsPath,
      generatedAt: new Date().toISOString(),
      testCases,
      coverageSummary: coverage,
    };
  }

  async saveArtifacts(suite: ManualTestSuite, outputDir: string): Promise<{ jsonPath: string; mdPath: string }> {
    await fs.ensureDir(outputDir);

    const slug = suite.component.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = `${slug}-manual-tests-${timestamp}`;

    // Save JSON
    const jsonPath = path.join(outputDir, `${baseName}.json`);
    await fs.writeJson(jsonPath, suite, { spaces: 2 });

    // Save human-readable Markdown
    const mdPath = path.join(outputDir, `${baseName}.md`);
    await fs.writeFile(mdPath, this.toMarkdown(suite), 'utf-8');

    logger.info(`📋 Manual test artifacts saved:\n  JSON: ${jsonPath}\n  MD:   ${mdPath}`);
    return { jsonPath, mdPath };
  }

  toMarkdown(suite: ManualTestSuite): string {
    const lines: string[] = [
      `# ${suite.suiteName}`,
      '',
      `**Suite ID:** ${suite.suiteId}  `,
      `**Component:** ${suite.component}  `,
      `**Generated:** ${suite.generatedAt}  `,
      `**Requirements:** ${suite.requirementsRef}  `,
      '',
      '## Coverage Summary',
      '',
      `| Type | Count |`,
      `|------|-------|`,
      `| Functional | ${suite.coverageSummary.functional} |`,
      `| Negative | ${suite.coverageSummary.negative} |`,
      `| Edge Cases | ${suite.coverageSummary.edgeCases} |`,
      `| UI | ${suite.coverageSummary.ui} |`,
      `| API | ${suite.coverageSummary.api} |`,
      `| Mobile | ${suite.coverageSummary.mobile} |`,
      `| **Total** | **${suite.testCases.length}** |`,
      '',
      '---',
      '',
      '## Test Cases',
      '',
    ];

    for (const tc of suite.testCases) {
      lines.push(`### ${tc.id}: ${tc.title}`);
      lines.push('');
      lines.push(`**Component:** ${tc.component}  `);
      lines.push(`**Type:** ${tc.type}  `);
      lines.push(`**Priority:** ${tc.priority}  `);
      lines.push(`**Status:** ${tc.status}  `);
      lines.push(`**Tags:** ${tc.tags.join(', ')}  `);
      lines.push('');
      lines.push(`**Description:** ${tc.description}`);
      lines.push('');

      if (tc.preconditions.length > 0) {
        lines.push('**Preconditions:**');
        tc.preconditions.forEach((p) => lines.push(`- ${p}`));
        lines.push('');
      }

      lines.push('**Test Steps:**');
      lines.push('');
      lines.push('| Step | Action | Expected Outcome |');
      lines.push('|------|--------|-----------------|');
      tc.steps.forEach((s) => {
        lines.push(`| ${s.stepNumber} | ${s.action} | ${s.expectedOutcome} |`);
      });
      lines.push('');
      lines.push(`**Expected Result:** ${tc.expectedResult}`);
      lines.push('');

      if (tc.acceptanceCriteria.length > 0) {
        lines.push('**Acceptance Criteria:**');
        tc.acceptanceCriteria.forEach((ac) => lines.push(`- [ ] ${ac}`));
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}
