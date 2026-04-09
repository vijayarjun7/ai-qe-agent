import * as path from 'path';
import * as fs from 'fs-extra';
import * as chokidar from 'chokidar';
import { ClaudeClient } from '../utils/ClaudeClient';
import { logger } from '../utils/Logger';

export type ChangeType = 'requirement' | 'locator' | 'logic' | 'style' | 'unknown';

export interface DetectedChange {
  changeId: string;
  filePath: string;
  relativePath: string;
  changedAt: string;
  changeType: ChangeType;
  component: string;          // which app component was affected
  diff: string;               // simplified before/after diff
  affectedTests: string[];    // test files that likely test this component
  action: 'auto-heal' | 'flag-for-review' | 'regenerate-tests' | 'ignore';
  reason: string;             // why this action was chosen
}

export interface WatchOptions {
  watchDir: string;           // e.g. 'demo-app/'
  testsDir?: string;          // e.g. 'tests/generated'
  onChange: (change: DetectedChange) => Promise<void>;
  debounceMs?: number;
}

// Files that signal a REQUIREMENT change (triggers re-gen of manual tests + flag for review)
const REQUIREMENT_FILE_PATTERNS = [
  /REQUIREMENTS\.md$/i,
  /requirements\//i,
  /\.requirements\.\w+$/i,
  /spec\.md$/i,
  /user-stories/i,
];

// Files that signal a LOCATOR change (UI component changed → triggers auto-heal)
const LOCATOR_FILE_PATTERNS = [
  /\.(tsx|jsx)$/,       // React components
  /\.(html|htm)$/,      // HTML templates
  /\.vue$/,             // Vue components
];

// Files that signal a LOGIC / API change
const LOGIC_FILE_PATTERNS = [
  /routes\//i,
  /controllers\//i,
  /services\//i,
  /api\//i,
  /\.(ts|js)$/,
];

// Files to ignore entirely
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist\//,
  /build\//,
  /\.map$/,
  /package-lock\.json$/,
];

export class ChangeDetector {
  private claude: ClaudeClient;
  private fileSnapshots: Map<string, string> = new Map();  // path → last known content

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Start watching a directory and call onChange for every meaningful file change.
   */
  watch(options: WatchOptions): chokidar.FSWatcher {
    const {
      watchDir,
      testsDir = 'tests/generated',
      onChange,
      debounceMs = 500,
    } = options;

    logger.info(`👁️  ChangeDetector watching: ${watchDir}`);

    const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

    const watcher = chokidar.watch(watchDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const handleChange = async (filePath: string, eventType: 'change' | 'add') => {
      // Skip ignored patterns
      if (IGNORE_PATTERNS.some((p) => p.test(filePath))) return;

      // Debounce rapid saves
      if (debounceMap.has(filePath)) clearTimeout(debounceMap.get(filePath)!);

      const timer = setTimeout(async () => {
        debounceMap.delete(filePath);
        try {
          const change = await this.analyzeChange(filePath, watchDir, testsDir, eventType);
          if (change) {
            logger.info(
              `🔄 Change detected: ${change.relativePath} → type=${change.changeType}, action=${change.action}`
            );
            await onChange(change);
          }
        } catch (err: any) {
          logger.error(`ChangeDetector error for ${filePath}: ${err.message}`);
        }
      }, debounceMs);

      debounceMap.set(filePath, timer);
    };

    watcher.on('change', (p) => handleChange(p, 'change'));
    watcher.on('add', (p) => handleChange(p, 'add'));
    watcher.on('error', (err) => logger.error(`Watcher error: ${err}`));

    return watcher;
  }

  /**
   * Analyse a single changed file and return a DetectedChange descriptor.
   * Returns null if the change should be ignored.
   */
  async analyzeChange(
    filePath: string,
    watchDir: string,
    testsDir: string,
    eventType: 'change' | 'add' = 'change'
  ): Promise<DetectedChange | null> {
    if (!await fs.pathExists(filePath)) return null;

    const relativePath = path.relative(process.cwd(), filePath);
    const newContent = await fs.readFile(filePath, 'utf-8').catch(() => '');
    const oldContent = this.fileSnapshots.get(filePath) || '';

    // Update snapshot
    this.fileSnapshots.set(filePath, newContent);

    if (oldContent === newContent && eventType === 'change') return null;  // no real change

    const changeType = this.classifyChangeType(filePath, oldContent, newContent);
    const component = this.extractComponent(filePath, watchDir);
    const affectedTests = await this.findAffectedTests(component, testsDir);
    const { action, reason } = this.decideAction(changeType, filePath);
    const diff = this.buildDiff(filePath, oldContent, newContent);

    return {
      changeId: `CHG-${Date.now()}`,
      filePath,
      relativePath,
      changedAt: new Date().toISOString(),
      changeType,
      component,
      diff,
      affectedTests,
      action,
      reason,
    };
  }

  /**
   * Use Claude to deeply classify whether a change affects requirements or locators.
   * Call this when the heuristic classifyChangeType returns 'unknown'.
   */
  async deepClassify(filePath: string, oldContent: string, newContent: string): Promise<ChangeType> {
    const prompt = `
A file was modified. Classify what kind of change this is.

FILE: ${path.basename(filePath)}
FILE TYPE: ${path.extname(filePath)}

OLD CONTENT (first 800 chars):
${oldContent.substring(0, 800)}

NEW CONTENT (first 800 chars):
${newContent.substring(0, 800)}

Classify the change as ONE of these types:
- "requirement": The functional requirements, acceptance criteria, user story, or expected behavior changed
- "locator": A UI component's HTML structure changed (element IDs, class names, data-testid, DOM hierarchy)
- "logic": Business logic, API behavior, or data processing changed but no UI or requirement change
- "style": Only CSS/styling changed, no functional impact
- "unknown": Cannot determine

Return ONLY one word from the list above. Nothing else.
`.trim();

    const result = await this.claude.complete(prompt, { maxTokens: 10 });
    const cleaned = result.trim().toLowerCase();
    const valid: ChangeType[] = ['requirement', 'locator', 'logic', 'style', 'unknown'];
    return valid.includes(cleaned as ChangeType) ? (cleaned as ChangeType) : 'unknown';
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private classifyChangeType(filePath: string, oldContent: string, newContent: string): ChangeType {
    // Requirements files
    if (REQUIREMENT_FILE_PATTERNS.some((p) => p.test(filePath))) return 'requirement';

    // UI component files — check if HTML structure changed (locator change)
    if (LOCATOR_FILE_PATTERNS.some((p) => p.test(filePath))) {
      const oldTestIds = this.extractTestIds(oldContent);
      const newTestIds = this.extractTestIds(newContent);
      const oldHtmlTags = this.extractHtmlStructure(oldContent);
      const newHtmlTags = this.extractHtmlStructure(newContent);

      if (
        JSON.stringify(oldTestIds) !== JSON.stringify(newTestIds) ||
        JSON.stringify(oldHtmlTags) !== JSON.stringify(newHtmlTags)
      ) {
        return 'locator';
      }
      // Check if only class names / IDs changed
      const oldIds = oldContent.match(/id=["']([^"']+)["']/g) || [];
      const newIds = newContent.match(/id=["']([^"']+)["']/g) || [];
      if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) return 'locator';

      return 'logic';
    }

    // CSS files
    if (/\.(css|scss|sass|less)$/.test(filePath)) return 'style';

    // Logic/API files
    if (LOGIC_FILE_PATTERNS.some((p) => p.test(filePath))) return 'logic';

    return 'unknown';
  }

  private extractTestIds(content: string): string[] {
    const matches = content.match(/data-testid=["']([^"']+)["']/g) || [];
    return matches.map((m) => m.replace(/data-testid=["']/, '').replace(/["']$/, '')).sort();
  }

  private extractHtmlStructure(content: string): string[] {
    // Extract element tag + role + type combinations (rough structural fingerprint)
    const matches = content.match(/<(button|input|form|select|textarea|a|nav|header|main)[^>]*>/gi) || [];
    return matches.slice(0, 20);
  }

  private extractComponent(filePath: string, watchDir: string): string {
    const rel = path.relative(watchDir, filePath);
    const parts = rel.split(path.sep);

    // Try to derive component name from path: frontend/src/pages/Login.tsx → Login
    for (const part of parts) {
      const name = path.basename(part, path.extname(part));
      if (name && name !== 'index' && name !== 'src' && name !== 'frontend' && name !== 'backend') {
        return name;
      }
    }
    return path.basename(filePath, path.extname(filePath));
  }

  private async findAffectedTests(component: string, testsDir: string): Promise<string[]> {
    if (!await fs.pathExists(testsDir)) return [];

    const files = await fs.readdir(testsDir);
    const componentLower = component.toLowerCase();

    return files
      .filter((f) => f.endsWith('.spec.ts') && (
        f.toLowerCase().includes(componentLower) ||
        f.toLowerCase().includes(componentLower.replace(/page$/, '')) ||
        componentLower === 'all'
      ))
      .map((f) => path.join(testsDir, f));
  }

  private decideAction(
    changeType: ChangeType,
    filePath: string
  ): { action: DetectedChange['action']; reason: string } {
    switch (changeType) {
      case 'requirement':
        return {
          action: 'flag-for-review',
          reason: 'Requirements changed — manual test cases and automation scripts may be outdated. Human review required before re-generating.',
        };

      case 'locator':
        return {
          action: 'auto-heal',
          reason: 'UI element structure changed — selectors in automation scripts may be broken. Triggering self-healing.',
        };

      case 'logic':
        return {
          action: 'regenerate-tests',
          reason: 'Business logic or API behavior changed — automation coverage may need updating.',
        };

      case 'style':
        return {
          action: 'ignore',
          reason: 'Style-only change — no impact on automation scripts.',
        };

      default:
        return {
          action: 'flag-for-review',
          reason: 'Unknown change type — flagging for manual review to be safe.',
        };
    }
  }

  private buildDiff(filePath: string, oldContent: string, newContent: string): string {
    if (!oldContent) return `[NEW FILE] ${path.basename(filePath)}`;

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines: string[] = [];

    // Simple line-diff (first 30 changed lines)
    const maxLines = Math.max(oldLines.length, newLines.length);
    let changes = 0;
    for (let i = 0; i < maxLines && changes < 30; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (oldLines[i] !== undefined) diffLines.push(`- ${oldLines[i]}`);
        if (newLines[i] !== undefined) diffLines.push(`+ ${newLines[i]}`);
        changes++;
      }
    }

    return diffLines.join('\n') || 'No line-level diff available';
  }
}
