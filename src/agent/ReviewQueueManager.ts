import * as path from 'path';
import * as fs from 'fs-extra';
import { DetectedChange } from './ChangeDetector';
import { logger } from '../utils/Logger';

export type ReviewItemStatus = 'pending' | 'in-review' | 'resolved' | 'dismissed';
export type ReviewItemReason = 'requirement-change' | 'unknown-change' | 'locator-change-complex' | 'manual-flag';

export interface ReviewQueueItem {
  ticketId: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewItemStatus;
  reason: ReviewItemReason;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  changedFile: string;
  changeType: string;
  diff: string;
  affectedTests: string[];
  requiredActions: string[];
  resolvedBy?: string;
  resolutionNotes?: string;
}

export interface ReviewQueueSummary {
  total: number;
  pending: number;
  inReview: number;
  resolved: number;
  dismissed: number;
  items: ReviewQueueItem[];
}

const QUEUE_DIR = 'tests/review-queue';
const QUEUE_INDEX = 'tests/review-queue/QUEUE.json';

export class ReviewQueueManager {

  /**
   * Add a detected change to the review queue.
   * Creates a ticket file and updates the queue index.
   */
  async addToQueue(change: DetectedChange, overrideReason?: ReviewItemReason): Promise<ReviewQueueItem> {
    await fs.ensureDir(QUEUE_DIR);

    const reason = overrideReason || this.mapChangeTypeToReason(change.changeType);
    const severity = this.determineSeverity(change);
    const requiredActions = this.buildRequiredActions(change);

    const item: ReviewQueueItem = {
      ticketId: `RQ-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',
      reason,
      title: this.buildTitle(change),
      description: this.buildDescription(change),
      severity,
      changedFile: change.relativePath,
      changeType: change.changeType,
      diff: change.diff,
      affectedTests: change.affectedTests,
      requiredActions,
    };

    // Save individual ticket file
    const ticketPath = path.join(QUEUE_DIR, `${item.ticketId}.json`);
    await fs.writeJson(ticketPath, item, { spaces: 2 });

    // Save human-readable ticket markdown
    const mdPath = path.join(QUEUE_DIR, `${item.ticketId}.md`);
    await fs.writeFile(mdPath, this.toMarkdown(item), 'utf-8');

    // Update queue index
    await this.updateQueueIndex(item);

    logger.warn(
      `🚩 Review ticket created: ${item.ticketId}\n` +
      `   File: ${change.relativePath}\n` +
      `   Reason: ${reason}\n` +
      `   Severity: ${severity}\n` +
      `   → ${mdPath}`
    );

    return item;
  }

  /**
   * Get the full queue summary.
   */
  async getQueue(): Promise<ReviewQueueSummary> {
    await fs.ensureDir(QUEUE_DIR);

    if (!await fs.pathExists(QUEUE_INDEX)) {
      return { total: 0, pending: 0, inReview: 0, resolved: 0, dismissed: 0, items: [] };
    }

    const items: ReviewQueueItem[] = await fs.readJson(QUEUE_INDEX).catch(() => []);
    return {
      total: items.length,
      pending: items.filter((i) => i.status === 'pending').length,
      inReview: items.filter((i) => i.status === 'in-review').length,
      resolved: items.filter((i) => i.status === 'resolved').length,
      dismissed: items.filter((i) => i.status === 'dismissed').length,
      items,
    };
  }

  /**
   * Update the status of a review ticket.
   */
  async updateStatus(
    ticketId: string,
    status: ReviewItemStatus,
    resolvedBy?: string,
    notes?: string
  ): Promise<ReviewQueueItem | null> {
    const ticketPath = path.join(QUEUE_DIR, `${ticketId}.json`);
    if (!await fs.pathExists(ticketPath)) {
      logger.error(`Review ticket not found: ${ticketId}`);
      return null;
    }

    const item: ReviewQueueItem = await fs.readJson(ticketPath);
    item.status = status;
    item.updatedAt = new Date().toISOString();
    if (resolvedBy) item.resolvedBy = resolvedBy;
    if (notes) item.resolutionNotes = notes;

    await fs.writeJson(ticketPath, item, { spaces: 2 });
    await fs.writeFile(path.join(QUEUE_DIR, `${ticketId}.md`), this.toMarkdown(item), 'utf-8');
    await this.updateQueueIndex(item);

    logger.info(`✅ Ticket ${ticketId} updated → status: ${status}`);
    return item;
  }

  /**
   * Print the review queue to console in a readable format.
   */
  async printQueue(): Promise<void> {
    const summary = await this.getQueue();
    console.log('\n📋 Review Queue Summary');
    console.log('═══════════════════════════════════════');
    console.log(`Total: ${summary.total} | Pending: ${summary.pending} | In-Review: ${summary.inReview} | Resolved: ${summary.resolved} | Dismissed: ${summary.dismissed}`);
    console.log('');

    const pending = summary.items.filter((i) => i.status === 'pending' || i.status === 'in-review');
    if (pending.length === 0) {
      console.log('✅ No pending review items.\n');
      return;
    }

    for (const item of pending) {
      const icon = item.severity === 'critical' ? '🔴' : item.severity === 'high' ? '🟠' : item.severity === 'medium' ? '🟡' : '🟢';
      console.log(`${icon} [${item.ticketId}] ${item.title}`);
      console.log(`   File: ${item.changedFile}`);
      console.log(`   Reason: ${item.reason}`);
      console.log(`   Created: ${item.createdAt}`);
      console.log(`   Actions needed:`);
      item.requiredActions.forEach((a) => console.log(`     • ${a}`));
      console.log('');
    }
  }

  /**
   * Generate an HTML dashboard of the review queue.
   */
  async generateQueueReport(outputPath = 'reports/review-queue.html'): Promise<string> {
    const summary = await this.getQueue();
    await fs.ensureDir(path.dirname(outputPath));

    const html = this.buildQueueHTML(summary);
    await fs.writeFile(outputPath, html, 'utf-8');
    logger.info(`📊 Review queue report → ${outputPath}`);
    return outputPath;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private mapChangeTypeToReason(changeType: string): ReviewItemReason {
    switch (changeType) {
      case 'requirement': return 'requirement-change';
      case 'locator': return 'locator-change-complex';
      default: return 'unknown-change';
    }
  }

  private determineSeverity(change: DetectedChange): ReviewQueueItem['severity'] {
    if (change.changeType === 'requirement') return 'critical';
    if (change.affectedTests.length > 3) return 'high';
    if (change.affectedTests.length > 0) return 'medium';
    return 'low';
  }

  private buildTitle(change: DetectedChange): string {
    const base = path.basename(change.relativePath);
    switch (change.changeType) {
      case 'requirement': return `Requirement change detected in ${base}`;
      case 'locator': return `UI structure change in ${base} — selectors may be broken`;
      case 'logic': return `Logic change in ${base} — test coverage review needed`;
      default: return `Unclassified change in ${base} — needs review`;
    }
  }

  private buildDescription(change: DetectedChange): string {
    const lines = [
      `File changed: ${change.relativePath}`,
      `Component: ${change.component}`,
      `Change type: ${change.changeType}`,
      `Detected at: ${change.changedAt}`,
      '',
      'Reason for flagging:',
      change.reason,
      '',
      `Affected tests (${change.affectedTests.length}):`,
      ...change.affectedTests.map((t) => `  - ${t}`),
    ];
    return lines.join('\n');
  }

  private buildRequiredActions(change: DetectedChange): string[] {
    switch (change.changeType) {
      case 'requirement':
        return [
          'Review the requirement change and understand the scope of impact',
          'Update manual test cases to reflect the new requirements',
          'Submit updated manual tests for peer review',
          'Regenerate automation scripts from the updated approved manual tests',
          'Re-run the full test suite against the app',
        ];
      case 'locator':
        return [
          'Review the UI change to understand which elements were modified',
          'Check if self-healing correctly updated all selectors',
          'Manually verify the healed selectors are stable',
          'Re-run affected automation tests to confirm they pass',
        ];
      case 'logic':
        return [
          'Review the logic change for test coverage impact',
          'Update or add API/unit tests for the changed logic',
          'Re-run the regression suite',
        ];
      default:
        return [
          'Review the change manually',
          'Determine if automation or manual test cases need updating',
          'Update or dismiss this ticket as appropriate',
        ];
    }
  }

  private async updateQueueIndex(item: ReviewQueueItem): Promise<void> {
    let items: ReviewQueueItem[] = [];
    if (await fs.pathExists(QUEUE_INDEX)) {
      items = await fs.readJson(QUEUE_INDEX).catch(() => []);
    }

    const existingIdx = items.findIndex((i) => i.ticketId === item.ticketId);
    if (existingIdx >= 0) {
      items[existingIdx] = item;
    } else {
      items.unshift(item);  // newest first
    }

    await fs.writeJson(QUEUE_INDEX, items, { spaces: 2 });
  }

  private toMarkdown(item: ReviewQueueItem): string {
    const statusEmoji = {
      'pending': '🔴',
      'in-review': '🟡',
      'resolved': '✅',
      'dismissed': '⬜',
    }[item.status];

    const severityEmoji = {
      'critical': '🔴 CRITICAL',
      'high': '🟠 HIGH',
      'medium': '🟡 MEDIUM',
      'low': '🟢 LOW',
    }[item.severity];

    const lines = [
      `# Review Ticket: ${item.ticketId}`,
      '',
      `**Status:** ${statusEmoji} ${item.status.toUpperCase()}  `,
      `**Severity:** ${severityEmoji}  `,
      `**Created:** ${item.createdAt}  `,
      `**Updated:** ${item.updatedAt}  `,
      '',
      `## ${item.title}`,
      '',
      item.description,
      '',
      '## Diff',
      '',
      '```diff',
      item.diff,
      '```',
      '',
      '## Affected Tests',
      '',
      item.affectedTests.length > 0
        ? item.affectedTests.map((t) => `- \`${t}\``).join('\n')
        : '_No affected tests identified_',
      '',
      '## Required Actions',
      '',
      item.requiredActions.map((a) => `- [ ] ${a}`).join('\n'),
      '',
    ];

    if (item.resolvedBy || item.resolutionNotes) {
      lines.push('## Resolution');
      lines.push('');
      if (item.resolvedBy) lines.push(`**Resolved by:** ${item.resolvedBy}  `);
      if (item.resolutionNotes) lines.push(`**Notes:** ${item.resolutionNotes}`);
    }

    return lines.join('\n');
  }

  private buildQueueHTML(summary: ReviewQueueSummary): string {
    const rows = summary.items.map((item) => {
      const statusColor = {
        'pending': '#ef4444',
        'in-review': '#f59e0b',
        'resolved': '#22c55e',
        'dismissed': '#6b7280',
      }[item.status];

      return `
      <tr>
        <td><code>${item.ticketId}</code></td>
        <td>${item.title}</td>
        <td><span class="badge" style="background:${statusColor}">${item.status}</span></td>
        <td>${item.severity}</td>
        <td>${item.changeType}</td>
        <td><code>${item.changedFile}</code></td>
        <td>${new Date(item.createdAt).toLocaleString()}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Review Queue — AI QE Agent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
  h1 { color: #f8fafc; margin-bottom: 0.5rem; }
  .subtitle { color: #94a3b8; margin-bottom: 2rem; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: #1e293b; border-radius: 8px; padding: 1.25rem; text-align: center; }
  .stat .value { font-size: 2rem; font-weight: 700; }
  .stat .label { color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem; }
  .stat.pending .value { color: #ef4444; }
  .stat.in-review .value { color: #f59e0b; }
  .stat.resolved .value { color: #22c55e; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
  th { background: #334155; padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; color: #94a3b8; }
  td { padding: 0.75rem 1rem; border-top: 1px solid #334155; font-size: 0.9rem; }
  .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; color: white; font-weight: 600; }
  code { background: #334155; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>🚩 Review Queue</h1>
<p class="subtitle">Items requiring human review before tests can be regenerated</p>
<div class="stats">
  <div class="stat"><div class="value">${summary.total}</div><div class="label">Total</div></div>
  <div class="stat pending"><div class="value">${summary.pending}</div><div class="label">Pending</div></div>
  <div class="stat in-review"><div class="value">${summary.inReview}</div><div class="label">In Review</div></div>
  <div class="stat resolved"><div class="value">${summary.resolved}</div><div class="label">Resolved</div></div>
  <div class="stat"><div class="value">${summary.dismissed}</div><div class="label">Dismissed</div></div>
</div>
<table>
<thead><tr>
  <th>Ticket</th><th>Title</th><th>Status</th><th>Severity</th><th>Change Type</th><th>File</th><th>Created</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
  }
}
