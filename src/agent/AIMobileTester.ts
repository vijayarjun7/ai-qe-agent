import * as path from 'path';
import * as fs from 'fs-extra';
import { ClaudeClient } from '../utils/ClaudeClient';
import { ManualTestSuite, ManualTestCase } from './ManualTestGenerator';
import { PageAnalyzer } from './PageAnalyzer';
import { saveTestFile, slugify } from '../utils/FileUtils';
import { logger } from '../utils/Logger';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface MobileDevice {
  name: string;
  playwrightDevice: string;   // maps to Playwright devices[] key
  width: number;
  height: number;
  platform: 'android' | 'ios';
  userAgentHint: string;
}

export interface MobileTestScenario {
  type: MobileTestType;
  name: string;
  description: string;
  enabled: boolean;
}

export type MobileTestType =
  | 'layout'           // responsive layout at breakpoints
  | 'navigation'       // hamburger menus, bottom nav, drawer
  | 'touch'            // tap targets, swipe gestures, long press
  | 'orientation'      // portrait ↔ landscape switching
  | 'network'          // offline, slow 3G, fast 4G simulation
  | 'performance'      // load time, LCP, CLS on mobile
  | 'accessibility'    // ARIA on mobile, screen reader hints
  | 'pwa'              // manifest, service worker, install prompt
  | 'forms'            // mobile keyboard, autocomplete, validation
  | 'media';           // images, videos scale correctly on mobile

export interface MobileTestOptions {
  url?: string;                      // live URL to analyse (optional)
  suite?: ManualTestSuite;           // manual test suite to automate from
  devices?: string[];                // device names to target (defaults to built-in set)
  scenarios?: MobileTestType[];      // which scenario types to generate
  outputDir?: string;
  testName?: string;
  breakpoints?: number[];            // custom viewport widths to test
}

export interface MobileTestResult {
  filePath: string;
  testCount: number;
  testNames: string[];
  devicesTargeted: string[];
  scenariosCovered: MobileTestType[];
}

// ─── Built-in device profiles ─────────────────────────────────────────────────

export const MOBILE_DEVICES: MobileDevice[] = [
  { name: 'iPhone SE',      playwrightDevice: 'iPhone SE',          width: 375,  height: 667,  platform: 'ios',     userAgentHint: 'iPhone' },
  { name: 'iPhone 13',      playwrightDevice: 'iPhone 13',          width: 390,  height: 844,  platform: 'ios',     userAgentHint: 'iPhone' },
  { name: 'iPhone 13 Pro Max', playwrightDevice: 'iPhone 13 Pro Max', width: 428, height: 926, platform: 'ios',    userAgentHint: 'iPhone' },
  { name: 'Pixel 5',        playwrightDevice: 'Pixel 5',            width: 393,  height: 851,  platform: 'android', userAgentHint: 'Android' },
  { name: 'Galaxy S21',     playwrightDevice: 'Galaxy S8',          width: 360,  height: 740,  platform: 'android', userAgentHint: 'Android' },
  { name: 'iPad Mini',      playwrightDevice: 'iPad Mini',          width: 768,  height: 1024, platform: 'ios',     userAgentHint: 'iPad' },
  { name: 'iPad Pro 11',    playwrightDevice: 'iPad Pro 11',        width: 834,  height: 1194, platform: 'ios',     userAgentHint: 'iPad' },
];

const DEFAULT_BREAKPOINTS = [320, 375, 393, 428, 768, 1024];

const DEFAULT_SCENARIOS: MobileTestType[] = [
  'layout', 'navigation', 'touch', 'orientation', 'network', 'performance', 'forms',
];

// ─── System prompts ───────────────────────────────────────────────────────────

const MOBILE_SYSTEM = `You are a Senior Mobile QA Automation Engineer with deep expertise in:
- Playwright mobile emulation (devices, viewports, touch events)
- iOS and Android responsive design testing
- WCAG 2.1 mobile accessibility
- Network condition simulation
- Mobile performance metrics (LCP, CLS, FID)

Rules:
- Import { test, expect, devices } from '@playwright/test'
- Use test.describe() for grouping by device or scenario type
- Use devices['iPhone 13'] etc for device emulation
- Use page.emulate(devices[...]) for per-test device switching
- Use page.setViewportSize() for custom breakpoints
- Touch: use page.tap(), page.touchscreen.tap(), page.swipe if needed
- Network: use page.route() to simulate slow/offline conditions
- Performance: use page.evaluate(() => performance.getEntriesByType(...))
- All selectors must use getByRole / getByTestId / getByLabel — never raw CSS
- Every test must have a clear pass/fail assertion with expect()
- Output ONLY valid TypeScript. No markdown fences. No explanations.`;

// ─── AIMobileTester ───────────────────────────────────────────────────────────

export class AIMobileTester {
  private claude: ClaudeClient;
  private analyzer: PageAnalyzer;

  constructor() {
    this.claude = new ClaudeClient();
    this.analyzer = new PageAnalyzer();
  }

  /**
   * Generate a comprehensive mobile test suite.
   * Can work from a live URL, an approved manual test suite, or both.
   */
  async generate(options: MobileTestOptions): Promise<MobileTestResult> {
    const {
      url,
      suite,
      devices: targetDevices = ['iPhone 13', 'Pixel 5', 'iPad Mini'],
      scenarios = DEFAULT_SCENARIOS,
      outputDir = 'tests/generated',
      testName,
      breakpoints = DEFAULT_BREAKPOINTS,
    } = options;

    if (!url && !suite) {
      throw new Error('Provide at least --url or --suite to generate mobile tests');
    }

    logger.info(`📱 AIMobileTester generating for devices: ${targetDevices.join(', ')}`);
    logger.info(`   Scenarios: ${scenarios.join(', ')}`);

    // Resolve device profiles
    const deviceProfiles = MOBILE_DEVICES.filter((d) => targetDevices.includes(d.name));
    if (deviceProfiles.length === 0) {
      // Fall back to defaults
      deviceProfiles.push(...MOBILE_DEVICES.slice(0, 3));
    }

    // Optionally analyse the live page for context
    let pageContext = '';
    if (url) {
      try {
        logger.info(`  🔍 Analysing live page: ${url}`);
        const analysis = await this.analyzer.analyze(url);
        pageContext = `
LIVE PAGE ANALYSIS:
- URL: ${analysis.url}
- Title: ${analysis.title}
- Forms: ${analysis.forms.length} form(s)
- Buttons: ${JSON.stringify(analysis.buttons.slice(0, 10).map((b) => b.text || b.ariaLabel))}
- Nav links: ${JSON.stringify(analysis.links.slice(0, 8).map((l) => l.text))}
- Headings: ${analysis.headings.join(', ')}
`.trim();
      } catch (err: any) {
        logger.warn(`  ⚠️  Could not analyse live page (${err.message}) — generating from spec only`);
      }
    }

    // Build manual test context
    let manualContext = '';
    if (suite) {
      const mobileCases = suite.testCases.filter(
        (t) => t.status === 'approved' && (t.type === 'mobile' || t.tags.includes('mobile') || t.tags.includes('responsive'))
      );
      const allApproved = suite.testCases.filter((t) => t.status === 'approved');
      const cases = mobileCases.length > 0 ? mobileCases : allApproved.slice(0, 8);
      manualContext = `
MANUAL TEST CASES TO AUTOMATE (${cases.length}):
${JSON.stringify(cases, null, 2)}
`.trim();
    }

    // Generate all scenario groups in parallel
    const scenarioTasks = scenarios.map((s) =>
      this.generateScenario(s, deviceProfiles, url, pageContext, manualContext, breakpoints)
    );
    const scenarioCodes = await Promise.all(scenarioTasks);

    // Stitch all scenario blocks into one file
    const fullCode = this.assembleFile(scenarioCodes, deviceProfiles, url || suite?.requirementsRef || '');

    const name = testName || (suite ? slugify(suite.component) + '-mobile' : 'mobile');
    const filePath = await saveTestFile(fullCode, `${name}.spec.ts`, outputDir);
    const testNames = this.extractTestNames(fullCode);

    logger.info(`✅ Mobile tests generated: ${testNames.length} tests → ${filePath}`);

    return {
      filePath,
      testCount: testNames.length,
      testNames,
      devicesTargeted: deviceProfiles.map((d) => d.name),
      scenariosCovered: scenarios,
    };
  }

  /**
   * Generate a specific scenario block (layout, touch, network, etc.)
   */
  private async generateScenario(
    scenario: MobileTestType,
    deviceProfiles: MobileDevice[],
    url: string | undefined,
    pageContext: string,
    manualContext: string,
    breakpoints: number[]
  ): Promise<string> {
    const prompt = this.buildScenarioPrompt(scenario, deviceProfiles, url, pageContext, manualContext, breakpoints);
    const raw = await this.claude.complete(prompt, {
      system: MOBILE_SYSTEM,
      maxTokens: 4096,
    });
    return this.cleanCode(raw);
  }

  private buildScenarioPrompt(
    scenario: MobileTestType,
    deviceProfiles: MobileDevice[],
    url: string | undefined,
    pageContext: string,
    manualContext: string,
    breakpoints: number[]
  ): string {
    const baseURL = url || process.env.BASE_URL || 'http://localhost:3000';
    const deviceList = deviceProfiles.map((d) => `- ${d.name} (${d.playwrightDevice}, ${d.width}×${d.height}, ${d.platform})`).join('\n');

    const scenarioInstructions: Record<MobileTestType, string> = {
      layout: `
Generate test.describe('Mobile Layout — ${scenario}') with tests that:
- Test at these breakpoints: ${breakpoints.join('px, ')}px using page.setViewportSize()
- Verify the task list stacks vertically (single column) at mobile widths
- Verify two-column or grid layout at tablet width (768px+)
- Assert no horizontal overflow: document.documentElement.scrollWidth <= window.innerWidth
- Check critical elements are visible at each breakpoint: login form, task list, add-task button
- Test that font sizes are legible (min 14px body, 16px for inputs to avoid iOS zoom)
- Use data-testid selectors throughout`,

      navigation: `
Generate test.describe('Mobile Navigation') with tests that:
- Emulate devices: ${deviceProfiles.slice(0, 2).map((d) => `devices['${d.playwrightDevice}']`).join(', ')}
- Test hamburger / mobile menu open and close
- Verify navigation links are reachable without scrolling on mobile
- Test back navigation (browser back button) works correctly
- Verify the app logo/title is visible in the header on mobile
- Test that the logout button is accessible from the mobile nav
- Include a test for bottom navigation bar if present`,

      touch: `
Generate test.describe('Touch Interactions') with tests that:
- Use page.tap() for all interactions (not page.click())
- Verify all interactive elements have a minimum touch target of 44×44px:
  const rect = await page.locator('[data-testid="login-btn"]').boundingBox()
  expect(rect!.width).toBeGreaterThanOrEqual(44)
  expect(rect!.height).toBeGreaterThanOrEqual(44)
- Test tap on task card opens edit mode
- Test tap on complete button toggles task status
- Test long-press or swipe gesture if task supports swipe-to-delete
- Verify tap does not trigger hover states that break mobile layout`,

      orientation: `
Generate test.describe('Orientation Changes') with tests that:
- Start in portrait mode (default device orientation)
- Switch to landscape: page.setViewportSize({ width: deviceHeight, height: deviceWidth })
- Verify the layout adapts and no content is cut off in landscape
- Verify the login form is still usable in landscape
- Verify the task list scrolls correctly in landscape
- Switch back to portrait and verify no layout artifacts remain
- Test at iPhone 13 dimensions: portrait 390×844, landscape 844×390`,

      network: `
Generate test.describe('Network Conditions') with tests that:
- Test offline behaviour:
  await page.route('**/*', route => route.abort())
  verify app shows an offline/error message gracefully
- Simulate slow 3G (latency ~400ms, download ~50kb/s):
  Use page.route() with artificial delay: await new Promise(r => setTimeout(r, 400))
  then route.continue()
  Verify page still loads and UI is usable within 8 seconds
- Test that critical API failures (mock 500 responses) show user-friendly error messages
- Verify the app does not crash or hang indefinitely on network errors`,

      performance: `
Generate test.describe('Mobile Performance') with tests that:
- Measure page load time and assert < 5000ms on mobile emulation
- Measure Largest Contentful Paint (LCP) using PerformanceObserver via page.evaluate:
  const lcp = await page.evaluate(() => new Promise(resolve => {
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      resolve(entries[entries.length-1].startTime)
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  }))
  expect(lcp).toBeLessThan(2500)
- Check JavaScript bundle size is not blocking: verify FCP < 1800ms
- Verify images use lazy loading (loading="lazy" attribute) on mobile
- Assert no layout shift during task list load (no CLS spikes)`,

      accessibility: `
Generate test.describe('Mobile Accessibility') with tests that:
- Verify all interactive elements have aria-label or visible text
- Test keyboard navigation works via page.keyboard.press('Tab')
- Check that form inputs have associated labels:
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
- Verify focus is visible (not hidden by CSS outline: none)
- Check colour contrast is sufficient (log elements that may fail WCAG AA)
- Test screen reader announcements by checking role and aria-live regions
- Verify modal dialogs trap focus correctly on mobile`,

      pwa: `
Generate test.describe('PWA / App-like Behaviour') with tests that:
- Check that a web app manifest is linked: page.locator('link[rel="manifest"]')
- Verify the app has a valid theme-color meta tag for mobile browser chrome colouring
- Check viewport meta tag is set: content='width=device-width, initial-scale=1'
- Verify the app is installable (check for beforeinstallprompt support via JS eval)
- Test that the app does not break when opened in standalone display mode:
  page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
- Check for service worker registration if offline support is expected`,

      forms: `
Generate test.describe('Mobile Form UX') with tests that:
- Test that input[type="email"] triggers email keyboard on mobile:
  verify inputmode or type attribute is correct
- Test that input[type="password"] is masked and has show/hide toggle
- Verify input[type="date"] shows native date picker on mobile
- Test form submission by filling and submitting on Pixel 5 emulation
- Verify form validation messages are visible and readable (not clipped)
- Check that the virtual keyboard does not cover the submit button
  (scroll into view: await page.locator('[data-testid="login-btn"]').scrollIntoViewIfNeeded())
- Test autocomplete attributes are set correctly (email, current-password)`,

      media: `
Generate test.describe('Media & Images') with tests that:
- Verify all images load without 404 errors (intercept image requests)
- Check images have alt text: page.locator('img:not([alt])')
- Verify responsive images use srcset or max-width: 100%:
  const imgStyle = await page.locator('img').first().evaluate(el => getComputedStyle(el).maxWidth)
  expect(imgStyle).toBe('100%')
- Test that images do not overflow their containers at 375px
- Check that no image causes layout shift on load
- Verify SVG icons scale correctly at all breakpoints`,
    };

    return `
Generate a Playwright TypeScript test suite for the MOBILE scenario: "${scenario.toUpperCase()}"

BASE URL: ${baseURL}

TARGET DEVICES:
${deviceList}

${pageContext ? pageContext + '\n' : ''}
${manualContext ? manualContext + '\n' : ''}
SCENARIO INSTRUCTIONS:
${scenarioInstructions[scenario]}

IMPORTANT:
- Wrap everything in test.describe('Mobile — ${this.capitalize(scenario)}', ...)
- Import { test, expect, devices } from '@playwright/test' at the top
- Use data-testid values: email-input, password-input, login-btn, task-list, add-task-btn,
  task-card, task-title, task-complete-btn, task-edit-btn, task-delete-btn, logout-btn,
  task-form, title-input, description-input, priority-select, save-task-btn
- Each test should be independent and not depend on state from other tests
- Use beforeEach to navigate to the correct page
- Output ONLY the TypeScript test.describe block. No imports. No explanations.
`.trim();
  }

  /**
   * Assemble all scenario blocks into a single .spec.ts file with shared imports and helpers.
   */
  private assembleFile(scenarioCodes: string[], deviceProfiles: MobileDevice[], targetRef: string): string {
    const deviceImports = deviceProfiles
      .map((d) => `  '${d.playwrightDevice}'`)
      .join(',\n');

    const header = `/**
 * Mobile Test Suite — AI Generated
 * Source: ${targetRef}
 * Generated: ${new Date().toISOString()}
 * Devices: ${deviceProfiles.map((d) => d.name).join(', ')}
 *
 * Run all mobile tests:
 *   npx playwright test --project=mobile-chrome
 *   npx playwright test --project=mobile-safari
 *
 * Run a specific scenario:
 *   npx playwright test -g "Mobile — Layout"
 */
import { test, expect, devices } from '@playwright/test';

// ─── Shared device helpers ──────────────────────────────────────────────────

const TARGET_DEVICES = [
${deviceImports}
];

/** Simulate slow 3G — use in network scenario tests */
async function simulateSlowNetwork(page: import('@playwright/test').Page, delayMs = 400) {
  await page.route('**/api/**', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.continue();
  });
}

/** Assert an element meets the 44×44px minimum touch target size */
async function assertTouchTarget(page: import('@playwright/test').Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, \`Touch target \${testId} not found\`).not.toBeNull();
  expect(box!.width, \`\${testId} width < 44px\`).toBeGreaterThanOrEqual(44);
  expect(box!.height, \`\${testId} height < 44px\`).toBeGreaterThanOrEqual(44);
}

/** Assert no horizontal scroll at current viewport */
async function assertNoHorizontalScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow, 'Horizontal scroll detected').toBe(false);
}

`;

    const body = scenarioCodes.join('\n\n// ─────────────────────────────────────────────────────────────────────────\n\n');
    return header + body;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private cleanCode(raw: string): string {
    return raw
      .replace(/^```(?:typescript|ts)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      // Remove stray import lines (we provide them in the header)
      .replace(/^import \{[^}]+\} from '@playwright\/test';\s*/gm, '')
      .trim();
  }

  private extractTestNames(code: string): string[] {
    const matches = code.match(/test\(['"`](.+?)['"`]/g) || [];
    return matches.map((m) => m.replace(/test\(['"`]/, '').replace(/['"`]$/, ''));
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Return the list of built-in device profiles for use in CLI help / reporting.
   */
  static getAvailableDevices(): MobileDevice[] {
    return MOBILE_DEVICES;
  }

  /**
   * Return the list of available scenario types.
   */
  static getAvailableScenarios(): MobileTestType[] {
    return ['layout', 'navigation', 'touch', 'orientation', 'network', 'performance', 'accessibility', 'pwa', 'forms', 'media'];
  }
}
