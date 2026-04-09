import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs-extra';
import { ClaudeClient } from '../utils/ClaudeClient';
import { readTestFile, writeTestFile, listGeneratedTests } from '../utils/FileUtils';
import { logger } from '../utils/Logger';

export interface HealingResult {
  filePath: string;
  healed: boolean;
  changes: SelectorChange[];
  originalContent: string;
  healedContent: string;
}

export interface SelectorChange {
  original: string;
  replacement: string;
  reason: string;
}

export interface BrokenSelector {
  selector: string;
  line: number;
  context: string;
}

export interface RequirementChangeResult {
  filePath: string;
  changeType: 'requirement' | 'unknown';
  flaggedForReview: boolean;
  ticketPath?: string;
  reason: string;
  affectedTests: string[];
}

const HEALING_SYSTEM_PROMPT = `You are an expert Playwright automation engineer specializing in self-healing test selectors.
When given a broken test file and the current state of the page, your job is to:
1. Identify which selectors are likely broken
2. Suggest robust replacement selectors based on the current page structure
3. Prefer: getByRole > getByLabel > getByTestId > getByText > CSS selectors
4. Return ONLY the fully corrected TypeScript test file, no explanations.`;

export class SelfHealingAgent {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Validate and self-heal a single test file against a live URL.
   */
  async healFile(testFilePath: string, targetURL: string): Promise<HealingResult> {
    logger.info(`🔧 Self-healing: ${testFilePath} against ${targetURL}`);

    const originalContent = await readTestFile(testFilePath);
    const brokenSelectors = this.extractSelectors(originalContent);

    if (brokenSelectors.length === 0) {
      logger.info('✅ No selectors found to validate');
      return {
        filePath: testFilePath,
        healed: false,
        changes: [],
        originalContent,
        healedContent: originalContent,
      };
    }

    // Capture live page DOM
    const liveDOMSnapshot = await this.captureLiveDOM(targetURL);

    // Identify broken selectors
    const validationResults = await this.validateSelectors(brokenSelectors, targetURL);
    const broken = validationResults.filter((v) => !v.valid);

    if (broken.length === 0) {
      logger.info('✅ All selectors are valid — no healing needed');
      return {
        filePath: testFilePath,
        healed: false,
        changes: [],
        originalContent,
        healedContent: originalContent,
      };
    }

    logger.warn(`⚠️  Found ${broken.length} broken selector(s) — asking Claude for fixes...`);

    const healedContent = await this.healWithClaude(
      originalContent,
      broken.map((b) => b.selector),
      liveDOMSnapshot
    );

    const changes = this.diffSelectors(originalContent, healedContent);

    await writeTestFile(testFilePath, healedContent);
    logger.info(`✅ Self-healing complete — ${changes.length} selector(s) updated`);

    return {
      filePath: testFilePath,
      healed: true,
      changes,
      originalContent,
      healedContent,
    };
  }

  /**
   * Heal all generated test files in a directory.
   */
  async healAll(targetURL: string, testsDir?: string): Promise<HealingResult[]> {
    const files = await listGeneratedTests(testsDir);
    logger.info(`🔧 Self-healing ${files.length} test file(s)...`);

    const results: HealingResult[] = [];
    for (const file of files) {
      try {
        const result = await this.healFile(file, targetURL);
        results.push(result);
      } catch (err: any) {
        logger.error(`Failed to heal ${file}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Detect if a requirements file changed and flag affected tests for review.
   * Returns a RequirementChangeResult indicating what was flagged.
   */
  async detectRequirementChange(
    requirementsFilePath: string,
    testsDir: string = 'tests/generated',
    reviewQueueDir: string = 'tests/review-queue'
  ): Promise<RequirementChangeResult> {
    logger.info(`🔍 Checking requirement change in: ${requirementsFilePath}`);

    if (!await fs.pathExists(requirementsFilePath)) {
      return {
        filePath: requirementsFilePath,
        changeType: 'unknown',
        flaggedForReview: false,
        reason: 'Requirements file not found',
        affectedTests: [],
      };
    }

    // Find all test files that might be affected
    const affectedTests: string[] = [];
    if (await fs.pathExists(testsDir)) {
      const files = await fs.readdir(testsDir);
      affectedTests.push(...files.filter((f) => f.endsWith('.spec.ts')).map((f) => path.join(testsDir, f)));
    }

    // Ask Claude to summarise what changed and whether tests need updating
    const content = await fs.readFile(requirementsFilePath, 'utf-8');
    const prompt = `
A requirements file was recently modified. Briefly state (in 2-3 sentences):
1. What the requirement change is about
2. Which test areas are most likely impacted

FILE: ${path.basename(requirementsFilePath)}
CONTENT (first 2000 chars):
${content.substring(0, 2000)}

Be concise. Plain text only.
`.trim();

    const aiSummary = await this.claude.complete(prompt, { maxTokens: 256 }).catch(() => 'Unable to summarise change.');

    // Create review queue ticket
    await fs.ensureDir(reviewQueueDir);
    const ticketId = `RQ-REQ-${Date.now()}`;
    const ticketPath = path.join(reviewQueueDir, `${ticketId}.md`);

    const ticket = [
      `# Review Ticket: ${ticketId}`,
      '',
      `**Status:** 🔴 PENDING  `,
      `**Type:** REQUIREMENT CHANGE — Cannot be auto-healed  `,
      `**Created:** ${new Date().toISOString()}  `,
      `**File:** ${requirementsFilePath}  `,
      '',
      '## AI Summary of Change',
      '',
      aiSummary,
      '',
      '## Affected Tests',
      '',
      affectedTests.length > 0
        ? affectedTests.map((t) => `- \`${t}\``).join('\n')
        : '_No existing tests found — need to generate from scratch_',
      '',
      '## Required Actions',
      '',
      '- [ ] Review the requirement change and understand the full scope',
      '- [ ] Update manual test cases to reflect new/changed requirements',
      '- [ ] Submit updated manual tests for QA peer review',
      '- [ ] Regenerate automation scripts from approved manual tests',
      '- [ ] Re-run the full test suite and verify all tests pass',
      '',
      '> ⚠️ This ticket was automatically created by the AI QE Agent.',
      '> Self-healing CANNOT be applied to requirement changes.',
      '> Human review and test re-generation is required.',
    ].join('\n');

    await fs.writeFile(ticketPath, ticket, 'utf-8');

    logger.warn(`\n🚩 REQUIREMENT CHANGE DETECTED — Flagged for manual review`);
    logger.warn(`   Requirements file: ${requirementsFilePath}`);
    logger.warn(`   Affected tests: ${affectedTests.length}`);
    logger.warn(`   Review ticket: ${ticketPath}`);
    logger.warn(`\n   ⚠️  Self-healing CANNOT fix requirement changes.`);
    logger.warn(`   Human review required before test re-generation.\n`);

    return {
      filePath: requirementsFilePath,
      changeType: 'requirement',
      flaggedForReview: true,
      ticketPath,
      reason: aiSummary,
      affectedTests,
    };
  }

  /**
   * Watch mode: monitor test failures and trigger healing automatically.
   */
  async watchAndHeal(targetURL: string, options: { interval?: number } = {}): Promise<void> {
    const interval = options.interval || 60_000; // default 1 minute
    logger.info(`👁️  Watch mode started — checking every ${interval / 1000}s`);

    const run = async () => {
      logger.info('🔄 Running healing cycle...');
      await this.healAll(targetURL);
    };

    await run();
    setInterval(run, interval);
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private extractSelectors(code: string): string[] {
    const patterns = [
      /page\.locator\(['"`](.+?)['"`]\)/g,
      /page\.\$\(['"`](.+?)['"`]\)/g,
      /page\.\$\$\(['"`](.+?)['"`]\)/g,
      /\.locator\(['"`](.+?)['"`]\)/g,
    ];

    const selectors = new Set<string>();
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        selectors.add(match[1]);
      }
    }
    return Array.from(selectors);
  }

  private async validateSelectors(
    selectors: string[],
    url: string
  ): Promise<Array<{ selector: string; valid: boolean }>> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const results: Array<{ selector: string; valid: boolean }> = [];

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      for (const selector of selectors) {
        try {
          // Skip Playwright semantic locators — they don't need validation here
          if (selector.startsWith('getBy')) {
            results.push({ selector, valid: true });
            continue;
          }
          const count = await page.locator(selector).count();
          results.push({ selector, valid: count > 0 });
        } catch {
          results.push({ selector, valid: false });
        }
      }
    } finally {
      await browser.close();
    }

    return results;
  }

  private async captureLiveDOM(url: string): Promise<string> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const html = await page.content();
      return html.substring(0, 15000); // Trim to avoid token limits
    } finally {
      await browser.close();
    }
  }

  private async healWithClaude(
    originalCode: string,
    brokenSelectors: string[],
    liveDOM: string
  ): Promise<string> {
    const prompt = `
The following Playwright TypeScript test file has broken selectors.

BROKEN SELECTORS:
${brokenSelectors.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

ORIGINAL TEST FILE:
\`\`\`typescript
${originalCode}
\`\`\`

CURRENT LIVE PAGE DOM (truncated):
\`\`\`html
${liveDOM}
\`\`\`

Fix ONLY the broken selectors using the most robust Playwright locator strategy available from the live DOM.
Return the complete, corrected TypeScript test file with NO markdown fences and NO explanation.
`.trim();

    const healed = await this.claude.complete(prompt, { system: HEALING_SYSTEM_PROMPT });
    return healed
      .replace(/^```(?:typescript|ts)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
  }

  private diffSelectors(original: string, healed: string): SelectorChange[] {
    const originalSelectors = this.extractSelectors(original);
    const healedSelectors = this.extractSelectors(healed);
    const changes: SelectorChange[] = [];

    for (let i = 0; i < originalSelectors.length; i++) {
      if (originalSelectors[i] !== healedSelectors[i]) {
        changes.push({
          original: originalSelectors[i] || '',
          replacement: healedSelectors[i] || '',
          reason: 'Selector not found in live DOM — replaced with robust alternative',
        });
      }
    }
    return changes;
  }
}
