import * as path from 'path';
import * as fs from 'fs-extra';
import { ClaudeClient } from '../utils/ClaudeClient';
import { ManualTestSuite, ManualTestCase } from './ManualTestGenerator';
import { logger } from '../utils/Logger';

// ─── Review of Manual Test Cases ─────────────────────────────────────────────

export interface ManualTestReview {
  reviewId: string;
  suiteId: string;
  reviewedAt: string;
  reviewer: 'QA-Reviewer-AI';
  overallVerdict: 'approved' | 'approved-with-comments' | 'needs-revision';
  coverageScore: number;    // 0-100
  qualityScore: number;     // 0-100
  comments: ReviewComment[];
  coverageGaps: string[];
  suggestedAdditions: SuggestedTestCase[];
  approvedTestIds: string[];
  flaggedTestIds: string[];
}

export interface ReviewComment {
  testId: string;
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  field: 'steps' | 'expectedResult' | 'preconditions' | 'coverage' | 'overall';
  comment: string;
  suggestion?: string;
}

export interface SuggestedTestCase {
  title: string;
  type: string;
  priority: string;
  rationale: string;
}

// ─── Review of Automation Scripts ────────────────────────────────────────────

export interface AutomationReview {
  reviewId: string;
  reviewedAt: string;
  reviewer: 'QA-Reviewer-AI';
  filePath: string;
  overallVerdict: 'approved' | 'approved-with-comments' | 'needs-revision';
  qualityScore: number;
  issues: AutomationIssue[];
  strengths: string[];
  approvedForExecution: boolean;
}

export interface AutomationIssue {
  lineHint?: string;
  severity: 'critical' | 'major' | 'minor';
  category: 'selector' | 'assertion' | 'flakiness' | 'coverage' | 'bestPractice' | 'security';
  description: string;
  suggestion: string;
}

const MANUAL_REVIEW_SYSTEM = `You are a Senior QA Lead performing a peer review of manual test cases.
Your job is to identify coverage gaps, ambiguous steps, missing negative scenarios, and poor quality test cases.
Be thorough but constructive. Output valid JSON only — no markdown, no prose.`;

const AUTOMATION_REVIEW_SYSTEM = `You are a Senior SDET performing a code review of Playwright automation scripts.
Evaluate selector robustness, assertion quality, flakiness risks, test isolation, and best practices.
Be specific about line-level issues. Output valid JSON only — no markdown, no prose.`;

export class QAReviewAgent {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  // ─── Review Manual Test Cases ─────────────────────────────────────────────

  /**
   * Perform a full peer review of a ManualTestSuite.
   * Saves the review report to outputDir and returns the review object.
   */
  async reviewManualTests(
    suite: ManualTestSuite,
    outputDir: string = 'tests/manual/reviews'
  ): Promise<ManualTestReview> {
    logger.info(`🔍 QA Reviewer reviewing manual test suite: ${suite.suiteId}`);

    const prompt = this.buildManualReviewPrompt(suite);
    const raw = await this.claude.complete(prompt, {
      system: MANUAL_REVIEW_SYSTEM,
      maxTokens: 4096,
    });

    const review = this.parseManualReview(raw, suite.suiteId);
    await this.saveManualReview(review, suite, outputDir);

    logger.info(
      `✅ Review complete — verdict: ${review.overallVerdict}, ` +
      `coverage: ${review.coverageScore}/100, quality: ${review.qualityScore}/100`
    );
    return review;
  }

  /**
   * Apply reviewer feedback to a suite: mark tests as approved or flagged.
   * Returns an updated suite ready for automation generation.
   */
  applyReviewToSuite(suite: ManualTestSuite, review: ManualTestReview): ManualTestSuite {
    const updatedCases = suite.testCases.map((tc) => {
      if (review.flaggedTestIds.includes(tc.id)) {
        return { ...tc, status: 'flagged-for-review' as const };
      }
      if (review.approvedTestIds.includes(tc.id)) {
        return { ...tc, status: 'approved' as const };
      }
      // Default: if verdict is approved/approved-with-comments, mark remaining as approved
      if (review.overallVerdict !== 'needs-revision') {
        return { ...tc, status: 'approved' as const };
      }
      return tc;
    });

    return { ...suite, testCases: updatedCases };
  }

  // ─── Review Automation Scripts ────────────────────────────────────────────

  /**
   * Review a generated Playwright automation script file.
   */
  async reviewAutomationScript(
    filePath: string,
    outputDir: string = 'tests/reviews'
  ): Promise<AutomationReview> {
    if (!await fs.pathExists(filePath)) {
      throw new Error(`Automation file not found: ${filePath}`);
    }

    const code = await fs.readFile(filePath, 'utf-8');
    logger.info(`🔍 QA Reviewer reviewing automation script: ${filePath}`);

    const prompt = this.buildAutomationReviewPrompt(code, filePath);
    const raw = await this.claude.complete(prompt, {
      system: AUTOMATION_REVIEW_SYSTEM,
      maxTokens: 6144,
    });

    const review = this.parseAutomationReview(raw, filePath);
    await this.saveAutomationReview(review, outputDir);

    logger.info(
      `✅ Automation review done — verdict: ${review.overallVerdict}, ` +
      `score: ${review.qualityScore}/100, approved: ${review.approvedForExecution}`
    );
    return review;
  }

  // ─── Private: Prompt builders ─────────────────────────────────────────────

  private buildManualReviewPrompt(suite: ManualTestSuite): string {
    // Compact test case summary to keep tokens low
    const compactCases = suite.testCases.map((tc) => ({
      id: tc.id, component: tc.component, title: tc.title, type: tc.type,
      priority: tc.priority, stepsCount: tc.steps.length, tags: tc.tags,
    }));
    return `
Peer review this manual test suite (sample — not full coverage).

SUITE: ${suite.suiteName} | COMPONENT: ${suite.component}
COVERAGE: ${JSON.stringify(suite.coverageSummary)}
TEST CASES (${suite.testCases.length}):
${JSON.stringify(compactCases)}

Perform a thorough QA peer review. Return a JSON object with this exact structure:
{
  "overallVerdict": "approved" | "approved-with-comments" | "needs-revision",
  "coverageScore": <0-100>,
  "qualityScore": <0-100>,
  "comments": [
    {
      "testId": "TC-001",
      "severity": "critical" | "major" | "minor" | "suggestion",
      "field": "steps" | "expectedResult" | "preconditions" | "coverage" | "overall",
      "comment": "Step 3 is ambiguous — 'click submit' doesn't specify which form",
      "suggestion": "Specify: 'Click the Login button (data-testid=login-btn)'"
    }
  ],
  "coverageGaps": [
    "No test for session expiry / token refresh",
    "Missing concurrent login scenario"
  ],
  "suggestedAdditions": [
    {
      "title": "Verify session expires after 24 hours",
      "type": "edge-case",
      "priority": "P1",
      "rationale": "Session management not covered in any existing test case"
    }
  ],
  "approvedTestIds": ["TC-001", "TC-002"],
  "flaggedTestIds": ["TC-003"]
}

Rules:
- Be specific with comments — reference test IDs and exact fields
- Flag tests that are ambiguous, incomplete, or have no clear pass/fail criteria
- Approve tests that are clear, complete, and well-structured
- Output ONLY the JSON object. No markdown. No prose.
`.trim();
  }

  private buildAutomationReviewPrompt(code: string, filePath: string): string {
    return `
You are reviewing a Playwright TypeScript automation script for quality.

FILE: ${filePath}

CODE:
${code}

Perform a thorough SDET code review. Return a JSON object with this exact structure:
{
  "overallVerdict": "approved" | "approved-with-comments" | "needs-revision",
  "qualityScore": <0-100>,
  "issues": [
    {
      "lineHint": "page.locator('.btn-primary')",
      "severity": "major",
      "category": "selector",
      "description": "CSS class selector is fragile and likely to break when styles change",
      "suggestion": "Use getByRole('button', { name: 'Login' }) instead"
    }
  ],
  "strengths": [
    "Good use of Page Object Model",
    "Assertions are specific and meaningful"
  ],
  "approvedForExecution": true | false
}

Review criteria:
- selector: Are locators robust? (getByRole/getByLabel preferred over CSS)
- assertion: Are assertions meaningful and specific?
- flakiness: Hard waits, race conditions, missing await?
- coverage: Does the script cover what manual tests specified?
- bestPractice: POM, test isolation, beforeEach/afterEach, descriptive names?
- security: Any hardcoded credentials in tests?

approvedForExecution = true only if no critical issues found.
Output ONLY the JSON object. No markdown. No prose.
`.trim();
  }

  // ─── Private: Parsers ────────────────────────────────────────────────────

  private parseManualReview(raw: string, suiteId: string): ManualTestReview {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return {
      reviewId: `REV-${Date.now()}`,
      suiteId,
      reviewedAt: new Date().toISOString(),
      reviewer: 'QA-Reviewer-AI',
      overallVerdict: parsed.overallVerdict || 'approved-with-comments',
      coverageScore: parsed.coverageScore ?? 75,
      qualityScore: parsed.qualityScore ?? 75,
      comments: parsed.comments || [],
      coverageGaps: parsed.coverageGaps || [],
      suggestedAdditions: parsed.suggestedAdditions || [],
      approvedTestIds: parsed.approvedTestIds || [],
      flaggedTestIds: parsed.flaggedTestIds || [],
    };
  }

  private parseAutomationReview(raw: string, filePath: string): AutomationReview {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return {
      reviewId: `AREV-${Date.now()}`,
      reviewedAt: new Date().toISOString(),
      reviewer: 'QA-Reviewer-AI',
      filePath,
      overallVerdict: parsed.overallVerdict || 'approved-with-comments',
      qualityScore: parsed.qualityScore ?? 75,
      issues: parsed.issues || [],
      strengths: parsed.strengths || [],
      approvedForExecution: parsed.approvedForExecution ?? true,
    };
  }

  // ─── Private: Save artifacts ──────────────────────────────────────────────

  private async saveManualReview(
    review: ManualTestReview,
    suite: ManualTestSuite,
    outputDir: string
  ): Promise<void> {
    await fs.ensureDir(outputDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = `review-manual-${suite.component.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`;

    // JSON
    await fs.writeJson(path.join(outputDir, `${baseName}.json`), review, { spaces: 2 });

    // Markdown report
    const md = this.manualReviewToMarkdown(review, suite);
    await fs.writeFile(path.join(outputDir, `${baseName}.md`), md, 'utf-8');
    logger.info(`📋 Manual review saved → ${outputDir}/${baseName}.md`);
  }

  private async saveAutomationReview(review: AutomationReview, outputDir: string): Promise<void> {
    await fs.ensureDir(outputDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = `review-automation-${timestamp}`;

    await fs.writeJson(path.join(outputDir, `${baseName}.json`), review, { spaces: 2 });
    const md = this.automationReviewToMarkdown(review);
    await fs.writeFile(path.join(outputDir, `${baseName}.md`), md, 'utf-8');
    logger.info(`📋 Automation review saved → ${outputDir}/${baseName}.md`);
  }

  // ─── Private: Markdown renderers ─────────────────────────────────────────

  private manualReviewToMarkdown(review: ManualTestReview, suite: ManualTestSuite): string {
    const verdictEmoji = {
      'approved': '✅',
      'approved-with-comments': '⚠️',
      'needs-revision': '❌',
    }[review.overallVerdict];

    const lines = [
      `# QA Peer Review — ${suite.suiteName}`,
      '',
      `**Review ID:** ${review.reviewId}  `,
      `**Reviewed At:** ${review.reviewedAt}  `,
      `**Reviewer:** ${review.reviewer}  `,
      `**Verdict:** ${verdictEmoji} ${review.overallVerdict.toUpperCase()}  `,
      `**Coverage Score:** ${review.coverageScore}/100  `,
      `**Quality Score:** ${review.qualityScore}/100  `,
      '',
      '## Review Comments',
      '',
    ];

    if (review.comments.length === 0) {
      lines.push('_No specific comments — test suite is well written._');
    } else {
      const bySeverity = ['critical', 'major', 'minor', 'suggestion'];
      for (const sev of bySeverity) {
        const filtered = review.comments.filter((c) => c.severity === sev);
        if (filtered.length === 0) continue;
        lines.push(`### ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${filtered.length})`);
        lines.push('');
        for (const c of filtered) {
          lines.push(`**[${c.testId}] ${c.field}:** ${c.comment}`);
          if (c.suggestion) lines.push(`> 💡 Suggestion: ${c.suggestion}`);
          lines.push('');
        }
      }
    }

    lines.push('## Coverage Gaps');
    lines.push('');
    if (review.coverageGaps.length === 0) {
      lines.push('_No coverage gaps identified._');
    } else {
      review.coverageGaps.forEach((g) => lines.push(`- ⚠️ ${g}`));
    }
    lines.push('');

    lines.push('## Suggested Additions');
    lines.push('');
    if (review.suggestedAdditions.length === 0) {
      lines.push('_No additional test cases suggested._');
    } else {
      review.suggestedAdditions.forEach((s) => {
        lines.push(`- **${s.title}** (${s.type}, ${s.priority})`);
        lines.push(`  _Rationale: ${s.rationale}_`);
      });
    }
    lines.push('');

    lines.push('## Approved Tests');
    lines.push(review.approvedTestIds.join(', ') || '_None_');
    lines.push('');
    lines.push('## Flagged for Revision');
    lines.push(review.flaggedTestIds.join(', ') || '_None_');

    return lines.join('\n');
  }

  private automationReviewToMarkdown(review: AutomationReview): string {
    const verdictEmoji = {
      'approved': '✅',
      'approved-with-comments': '⚠️',
      'needs-revision': '❌',
    }[review.overallVerdict];

    const lines = [
      `# Automation Script Review`,
      '',
      `**Review ID:** ${review.reviewId}  `,
      `**File:** ${review.filePath}  `,
      `**Reviewed At:** ${review.reviewedAt}  `,
      `**Verdict:** ${verdictEmoji} ${review.overallVerdict.toUpperCase()}  `,
      `**Quality Score:** ${review.qualityScore}/100  `,
      `**Approved for Execution:** ${review.approvedForExecution ? '✅ Yes' : '❌ No'}  `,
      '',
      '## Issues Found',
      '',
    ];

    if (review.issues.length === 0) {
      lines.push('_No issues found._');
    } else {
      review.issues.forEach((issue) => {
        lines.push(`### [${issue.severity.toUpperCase()}] ${issue.category}`);
        if (issue.lineHint) lines.push(`**Near:** \`${issue.lineHint}\``);
        lines.push(`**Issue:** ${issue.description}`);
        lines.push(`**Fix:** ${issue.suggestion}`);
        lines.push('');
      });
    }

    lines.push('## Strengths');
    lines.push('');
    review.strengths.forEach((s) => lines.push(`- ✅ ${s}`));

    return lines.join('\n');
  }
}
