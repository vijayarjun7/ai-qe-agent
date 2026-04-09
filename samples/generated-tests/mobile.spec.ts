/**
 * Mobile Test Suite — AI Generated
 * Source: http://localhost:3000
 * Generated: 2026-04-09T20:19:15.353Z
 * Devices: iPhone 13, Pixel 5
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
  'iPhone 13',
  'Pixel 5'
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
  expect(box, `Touch target ${testId} not found`).not.toBeNull();
  expect(box!.width, `${testId} width < 44px`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${testId} height < 44px`).toBeGreaterThanOrEqual(44);
}

/** Assert no horizontal scroll at current viewport */
async function assertNoHorizontalScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow, 'Horizontal scroll detected').toBe(false);
}

test.describe('Mobile — Layout', () => {
  const BASE_URL = 'http://localhost:3000';

  const mobileBreakpoints = [
    { width: 320, height: 568, label: '320px' },
    { width: 375, height: 667, label: '375px' },
    { width: 393, height: 851, label: '393px' },
    { width: 428, height: 926, label: '428px' },
  ];

  const tabletBreakpoints = [
    { width: 768, height: 1024, label: '768px' },
    { width: 1024, height: 1366, label: '1024px' },
  ];

  const allBreakpoints = [...mobileBreakpoints, ...tabletBreakpoints];

  async function loginUser(page: any) {
    await page.getByTestId('email-input').fill('testuser@example.com');
    await page.getByTestId('password-input').fill('Password123!');
    await page.getByTestId('login-btn').click();
    await page.waitForURL(`${BASE_URL}/tasks`, { timeout: 10000 }).catch(() => {});
  }

  test.describe('iPhone 13', () => {
    test.use({ ...devices['iPhone 13'] });

    test.beforeEach(async ({ page }) => {
      await page.goto(BASE_URL);
    });

    test('login form is visible on iPhone 13 default viewport', async ({ page }) => {
      await expect(page.getByTestId('email-input')).toBeVisible();
      await expect(page.getByTestId('password-input')).toBeVisible();
      await expect(page.getByTestId('login-btn')).toBeVisible();
    });

    test('no horizontal overflow on iPhone 13 viewport', async ({ page }) => {
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);
    });

    test('input font sizes meet 16px minimum on iPhone 13 to prevent iOS zoom', async ({ page }) => {
      const emailFontSize = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="email-input"]');
        if (!el) return 0;
        return parseFloat(window.getComputedStyle(el).fontSize);
      });
      const passwordFontSize = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="password-input"]');
        if (!el) return 0;
        return parseFloat(window.getComputedStyle(el).fontSize);
      });
      expect(emailFontSize).toBeGreaterThanOrEqual(16);
      expect(passwordFontSize).toBeGreaterThanOrEqual(16);
    });

    test('task list is visible and stacks vertically after login on iPhone 13', async ({ page }) => {
      await loginUser(page);
      await expect(page.getByTestId('task-list')).toBeVisible();
      await expect(page.getByTestId('add-task-btn')).toBeVisible();

      const taskCards = page.getByTestId('task-card');
      const count = await taskCards.count();
      if (count >= 2) {
        const firstCard = await taskCards.nth(0).boundingBox();
        const secondCard = await taskCards.nth(1).boundingBox();
        expect(firstCard).not.toBeNull();
        expect(secondCard).not.toBeNull();
        if (firstCard && secondCard) {
          expect(secondCard.y).toBeGreaterThan(firstCard.y + firstCard.height - 5);
          expect(Math.abs(firstCard.x - secondCard.x)).toBeLessThan(20);
        }
      }
    });

    test('no horizontal overflow after login on iPhone 13', async ({ page }) => {
      await loginUser(page);
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);
    });
  });

  test.describe('Pixel 5', () => {
    test.use({ ...devices['Pixel 5'] });

    test.beforeEach(async ({ page }) => {
      await page.goto(BASE_URL);
    });

    test('login form is visible on Pixel 5 default viewport', async ({ page }) => {
      await expect(page.getByTestId('email-input')).toBeVisible();
      await expect(page.getByTestId('password-input')).toBeVisible();
      await expect(page.getByTestId('login-btn')).toBeVisible();
    });

    test('no horizontal overflow on Pixel 5 viewport', async ({ page }) => {
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);
    });

    test('input font sizes meet 16px minimum on Pixel 5', async ({ page }) => {
      const emailFontSize = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="email-input"]');
        if (!el) return 0;
        return parseFloat(window.getComputedStyle(el).fontSize);
      });
      const passwordFontSize = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="password-input"]');
        if (!el) return 0;
        return parseFloat(window.getComputedStyle(el).fontSize);
      });
      expect(emailFontSize).toBeGreaterThanOrEqual(16);
      expect(passwordFontSize).toBeGreaterThanOrEqual(16);
    });

    test('task list stacks vertically after login on Pixel 5', async ({ page }) => {
      await loginUser(page);
      await expect(page.getByTestId('task-list')).toBeVisible();
      await expect(page.getByTestId('add-task-btn')).toBeVisible();

      const taskCards = page.getByTestId('task-card');
      const count = await taskCards.count();
      if (count >= 2) {
        const firstCard = await taskCards.nth(0).boundingBox();
        const secondCard = await taskCards.nth(1).boundingBox();
        expect(firstCard).not.toBeNull();
        expect(secondCard).not.toBeNull();
        if (firstCard && secondCard) {
          expect(secondCard.y).toBeGreaterThan(firstCard.y + firstCard.height - 5);
          expect(Math.abs(firstCard.x - secondCard.x)).toBeLessThan(20);
        }
      }
    });

    test('no horizontal overflow after login on Pixel 5', async ({ page }) => {
      await loginUser(page);
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflow).toBe(false);
    });
  });

  test.describe('Breakpoint — Login Page Visibility', () => {
    for (const bp of allBreakpoints) {
      test(`login form elements visible at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);

        await expect(page.getByTestId('email-input')).toBeVisible();
        await expect(page.getByTestId('password-input')).toBeVisible();
        await expect(page.getByTestId('login-btn')).toBeVisible();
      });
    }
  });

  test.describe('Breakpoint — No Horizontal Overflow on Login Page', () => {
    for (const bp of allBreakpoints) {
      test(`no horizontal overflow on login page at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);

        const hasOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(hasOverflow).toBe(false);
      });
    }
  });

  test.describe('Breakpoint — Input Font Sizes on Login Page', () => {
    for (const bp of allBreakpoints) {
      test(`input font size >= 16px at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);

        const emailFontSize = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="email-input"]');
          if (!el) return 0;
          return parseFloat(window.getComputedStyle(el).fontSize);
        });
        const passwordFontSize = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="password-input"]');
          if (!el) return 0;
          return parseFloat(window.getComputedStyle(el).fontSize);
        });

        expect(emailFontSize).toBeGreaterThanOrEqual(16);
        expect(passwordFontSize).toBeGreaterThanOrEqual(16);
      });
    }
  });

  test.describe('Breakpoint — Mobile Single Column Layout', () => {
    for (const bp of mobileBreakpoints) {
      test(`task list stacks single column at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        await expect(page.getByTestId('task-list')).toBeVisible();
        await expect(page.getByTestId('add-task-btn')).toBeVisible();

        const taskCards = page.getByTestId('task-card');
        const count = await taskCards.count();
        if (count >= 2) {
          const firstCard = await taskCards.nth(0).boundingBox();
          const secondCard = await taskCards.nth(1).boundingBox();
          expect(firstCard).not.toBeNull();
          expect(secondCard).not.toBeNull();
          if (firstCard && secondCard) {
            expect(secondCard.y).toBeGreaterThan(firstCard.y + firstCard.height - 5);
            expect(Math.abs(firstCard.x - secondCard.x)).toBeLessThan(20);
          }
        }

        const hasOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(hasOverflow).toBe(false);
      });
    }
  });

  test.describe('Breakpoint — Tablet Multi-Column Layout', () => {
    for (const bp of tabletBreakpoints) {
      test(`task list uses grid or two-column layout at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        await expect(page.getByTestId('task-list')).toBeVisible();
        await expect(page.getByTestId('add-task-btn')).toBeVisible();

        const taskCards = page.getByTestId('task-card');
        const count = await taskCards.count();
        if (count >= 2) {
          const firstCard = await taskCards.nth(0).boundingBox();
          const secondCard = await taskCards.nth(1).boundingBox();
          expect(firstCard).not.toBeNull();
          expect(secondCard).not.toBeNull();
          if (firstCard && secondCard) {
            const isMultiColumn = Math.abs(firstCard.y - secondCard.y) < firstCard.height / 2
              && Math.abs(firstCard.x - secondCard.x) > firstCard.width / 4;
            const isSingleColumn = secondCard.y >= firstCard.y + firstCard.height - 5;
            expect(isMultiColumn || isSingleColumn).toBe(true);
          }
        }

        const hasOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(hasOverflow).toBe(false);
      });
    }
  });

  test.describe('Breakpoint — Task List No Overflow', () => {
    for (const bp of allBreakpoints) {
      test(`no horizontal overflow on task list page at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        const hasOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(hasOverflow).toBe(false);
      });
    }
  });

  test.describe('Breakpoint — Critical Elements Visibility After Login', () => {
    for (const bp of allBreakpoints) {
      test(`critical elements visible at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        await expect(page.getByTestId('task-list')).toBeVisible();
        await expect(page.getByTestId('add-task-btn')).toBeVisible();
        await expect(page.getByTestId('logout-btn')).toBeVisible();
      });
    }
  });

  test.describe('Breakpoint — Body Font Size Legibility', () => {
    for (const bp of allBreakpoints) {
      test(`body font size >= 14px at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        const bodyFontSize = await page.evaluate(() => {
          return parseFloat(window.getComputedStyle(document.body).fontSize);
        });
        expect(bodyFontSize).toBeGreaterThanOrEqual(14);
      });
    }
  });

  test.describe('Breakpoint — Task Title Font Size Legibility', () => {
    for (const bp of allBreakpoints) {
      test(`task title font size >= 14px at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        const taskTitles = page.getByTestId('task-title');
        const count = await taskTitles.count();
        if (count > 0) {
          const fontSize = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="task-title"]');
            if (!el) return 0;
            return parseFloat(window.getComputedStyle(el).fontSize);
          });
          expect(fontSize).toBeGreaterThanOrEqual(14);
        } else {
          test.skip();
        }
      });
    }
  });

  test.describe('Breakpoint — Add Task Form Inputs Font Size', () => {
    for (const bp of allBreakpoints) {
      test(`add task form inputs >= 16px to prevent iOS zoom at ${bp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(BASE_URL);
        await loginUser(page);

        await page.getByTestId('add-task-btn').tap().catch(() =>
          page.getByTestId('add-task-btn').click()
        );

        const taskFormVisible = await page.getByTestId('task-form').isVisible().catch(() => false);
        if (taskFormVisible) {
          const titleFontSize = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="title-input

// ─────────────────────────────────────────────────────────────────────────

test.describe('Mobile — Navigation', () => {
  const mobileDevices = [
    { name: 'iPhone 13', device: devices['iPhone 13'] },
    { name: 'Pixel 5', device: devices['Pixel 5'] },
  ];

  for (const { name, device } of mobileDevices) {
    test.describe(`${name}`, () => {
      test.use({ ...device });

      test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:3000');
        const emailInput = page.getByTestId('email-input');
        const isLoginPage = await emailInput.isVisible().catch(() => false);
        if (isLoginPage) {
          await page.getByTestId('email-input').fill('testuser@example.com');
          await page.getByTestId('password-input').fill('password123');
          await page.getByTestId('login-btn').tap();
          await expect(page.getByTestId('task-list')).toBeVisible({ timeout: 10000 });
        }
      });

      test(`[${name}] hamburger menu opens and closes`, async ({ page }) => {
        const hamburger = page.getByRole('button', { name: /menu|hamburger|open navigation/i });
        await expect(hamburger).toBeVisible();

        await hamburger.tap();

        const navMenu = page.getByRole('navigation');
        await expect(navMenu).toBeVisible();

        const closeButton = page.getByRole('button', { name: /close|dismiss|close menu/i });
        const closeVisible = await closeButton.isVisible().catch(() => false);
        if (closeVisible) {
          await closeButton.tap();
        } else {
          await hamburger.tap();
        }

        await expect(navMenu).toBeHidden({ timeout: 5000 });
      });

      test(`[${name}] navigation links are reachable without scrolling on mobile`, async ({ page }) => {
        const hamburger = page.getByRole('button', { name: /menu|hamburger|open navigation/i });
        const hamburgerVisible = await hamburger.isVisible().catch(() => false);

        if (hamburgerVisible) {
          await hamburger.tap();
        }

        const navMenu = page.getByRole('navigation');
        await expect(navMenu).toBeVisible();

        const navLinks = navMenu.getByRole('link');
        const linkCount = await navLinks.count();
        expect(linkCount).toBeGreaterThan(0);

        for (let i = 0; i < linkCount; i++) {
          const link = navLinks.nth(i);
          const box = await link.boundingBox();
          expect(box).not.toBeNull();
          if (box) {
            const viewport = page.viewportSize();
            expect(viewport).not.toBeNull();
            if (viewport) {
              expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
            }
          }
        }
      });

      test(`[${name}] back navigation works correctly with browser back button`, async ({ page }) => {
        const hamburger = page.getByRole('button', { name: /menu|hamburger|open navigation/i });
        const hamburgerVisible = await hamburger.isVisible().catch(() => false);

        if (hamburgerVisible) {
          await hamburger.tap();
        }

        const navMenu = page.getByRole('navigation');
        const settingsLink = navMenu.getByRole('link', { name: /settings|profile|account/i });
        const settingsVisible = await settingsLink.isVisible().catch(() => false);

        if (settingsVisible) {
          const initialUrl = page.url();
          await settingsLink.tap();
          await page.waitForURL((url) => url.toString() !== initialUrl, { timeout: 5000 });
          const navigatedUrl = page.url();
          expect(navigatedUrl).not.toBe(initialUrl);

          await page.goBack();
          await page.waitForURL(initialUrl, { timeout: 5000 });
          expect(page.url()).toBe(initialUrl);
        } else {
          const taskCard = page.getByTestId('task-card').first();
          const taskCardVisible = await taskCard.isVisible().catch(() => false);

          if (taskCardVisible) {
            const initialUrl = page.url();
            await taskCard.tap();
            await page.waitForTimeout(500);
            const navigatedUrl = page.url();

            if (navigatedUrl !== initialUrl) {
              await page.goBack();
              await page.waitForURL(initialUrl, { timeout: 5000 });
              expect(page.url()).toBe(initialUrl);
            } else {
              expect(page.url()).toBe(initialUrl);
            }
          } else {
            const currentUrl = page.url();
            expect(currentUrl).toContain('localhost:3000');
          }
        }
      });

      test(`[${name}] app logo or title is visible in the header on mobile`, async ({ page }) => {
        const header = page.getByRole('banner');
        await expect(header).toBeVisible();

        const logo = header.getByRole('img', { name: /logo|brand|app/i });
        const logoVisible = await logo.isVisible().catch(() => false);

        if (logoVisible) {
          await expect(logo).toBeVisible();
          const box = await logo.boundingBox();
          expect(box).not.toBeNull();
        } else {
          const title = header.getByRole('heading').first();
          const titleVisible = await title.isVisible().catch(() => false);

          if (titleVisible) {
            await expect(title).toBeVisible();
          } else {
            const brandLink = header.getByRole('link').first();
            await expect(brandLink).toBeVisible();
          }
        }
      });

      test(`[${name}] logout button is accessible from mobile navigation`, async ({ page }) => {
        const directLogout = page.getByTestId('logout-btn');
        const directLogoutVisible = await directLogout.isVisible().catch(() => false);

        if (directLogoutVisible) {
          await expect(directLogout).toBeVisible();
        } else {
          const hamburger = page.getByRole('button', { name: /menu|hamburger|open navigation/i });
          const hamburgerVisible = await hamburger.isVisible().catch(() => false);

          if (hamburgerVisible) {
            await hamburger.tap();
          }

          const navMenu = page.getByRole('navigation');
          await expect(navMenu).toBeVisible();

          const logoutBtn = page.getByTestId('logout-btn');
          const logoutInNav = await logoutBtn.isVisible().catch(() => false);

          if (logoutInNav) {
            await expect(logoutBtn).toBeVisible();
          } else {
            const logoutByRole = navMenu.getByRole('button', { name: /logout|sign out|log out/i });
            const logoutByRoleVisible = await logoutByRole.isVisible().catch(() => false);

            if (logoutByRoleVisible) {
              await expect(logoutByRole).toBeVisible();
            } else {
              const logoutLink = navMenu.getByRole('link', { name: /logout|sign out|log out/i });
              await expect(logoutLink).toBeVisible();
            }
          }
        }
      });

      test(`[${name}] bottom navigation bar is visible and functional if present`, async ({ page }) => {
        const bottomNav = page.getByRole('navigation', { name: /bottom|tab bar|footer nav/i });
        const bottomNavVisible = await bottomNav.isVisible().catch(() => false);

        if (!bottomNavVisible) {
          const footerNav = page.locator('[data-testid*="bottom-nav"], [aria-label*="bottom"], [role="tablist"]');
          const footerNavVisible = await footerNav.isVisible().catch(() => false);

          if (!footerNavVisible) {
            test.skip();
            return;
          }

          const tabItems = footerNav.getByRole('tab');
          const tabCount = await tabItems.count();

          if (tabCount > 0) {
            expect(tabCount).toBeGreaterThan(0);

            const firstTab = tabItems.first();
            await expect(firstTab).toBeVisible();
            const box = await firstTab.boundingBox();
            expect(box).not.toBeNull();

            if (box) {
              const viewport = page.viewportSize();
              expect(viewport).not.toBeNull();
              if (viewport) {
                expect(box.y).toBeGreaterThan(viewport.height / 2);
              }
            }
          }
          return;
        }

        const tabItems = bottomNav.getByRole('link');
        const tabCount = await tabItems.count();
        expect(tabCount).toBeGreaterThan(0);

        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();

        const navBox = await bottomNav.boundingBox();
        expect(navBox).not.toBeNull();

        if (navBox && viewport) {
          expect(navBox.y).toBeGreaterThan(viewport.height / 2);
        }

        const firstTab = tabItems.first();
        await expect(firstTab).toBeVisible();
        await firstTab.tap();
        await page.waitForTimeout(300);

        const activeTab = bottomNav.locator('[aria-current="page"], [aria-selected="true"], .active');
        const activeTabVisible = await activeTab.isVisible().catch(() => false);
        if (activeTabVisible) {
          await expect(activeTab).toBeVisible();
        } else {
          await expect(firstTab).toBeVisible();
        }
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────

test.describe('Mobile — Touch', () => {
  const deviceList = [
    { name: 'iPhone 13', device: devices['iPhone 13'] },
    { name: 'Pixel 5', device: devices['Pixel 5'] },
  ];

  for (const { name, device } of deviceList) {
    test.describe(`Touch Interactions — ${name}`, () => {
      test.use({ ...device });

      test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:3000');
        await page.getByTestId('email-input').tap();
        await page.getByTestId('email-input').fill('testuser@example.com');
        await page.getByTestId('password-input').tap();
        await page.getByTestId('password-input').fill('password123');
        await page.getByTestId('login-btn').tap();
        await page.getByTestId('task-list').waitFor({ state: 'visible' });
      });

      test(`[${name}] login-btn meets 44×44px minimum touch target`, async ({ page }) => {
        await page.goto('http://localhost:3000');
        const rect = await page.getByTestId('login-btn').boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      });

      test(`[${name}] add-task-btn meets 44×44px minimum touch target`, async ({ page }) => {
        const rect = await page.getByTestId('add-task-btn').boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      });

      test(`[${name}] task-complete-btn meets 44×44px minimum touch target`, async ({ page }) => {
        const rect = await page.getByTestId('task-complete-btn').first().boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      });

      test(`[${name}] task-edit-btn meets 44×44px minimum touch target`, async ({ page }) => {
        const rect = await page.getByTestId('task-edit-btn').first().boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      });

      test(`[${name}] task-delete-btn meets 44×44px minimum touch target`, async ({ page }) => {
        const rect = await page.getByTestId('task-delete-btn').first().boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      });

      test(`[${name}] logout-btn meets 44×44px minimum touch target`, async ({ page }) => {
        const rect = await page.getByTestId('logout-btn').boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      });

      test(`[${name}] tap on task card opens edit mode`, async ({ page }) => {
        await page.getByTestId('task-card').first().tap();
        await expect(page.getByTestId('task-form')).toBeVisible();
        await expect(page.getByTestId('title-input')).toBeVisible();
        await expect(page.getByTestId('description-input')).toBeVisible();
        await expect(page.getByTestId('priority-select')).toBeVisible();
        await expect(page.getByTestId('save-task-btn')).toBeVisible();
      });

      test(`[${name}] tap on task-edit-btn opens edit form for that task`, async ({ page }) => {
        const firstCard = page.getByTestId('task-card').first();
        const taskTitle = await firstCard.getByTestId('task-title').innerText();
        await firstCard.getByTestId('task-edit-btn').tap();
        await expect(page.getByTestId('task-form')).toBeVisible();
        const titleInputValue = await page.getByTestId('title-input').inputValue();
        expect(titleInputValue).toBe(taskTitle);
      });

      test(`[${name}] tap on task-complete-btn toggles task completion status`, async ({ page }) => {
        const firstCompleteBtn = page.getByTestId('task-complete-btn').first();
        const initialAriaChecked = await firstCompleteBtn.getAttribute('aria-checked');
        await firstCompleteBtn.tap();
        const updatedAriaChecked = await firstCompleteBtn.getAttribute('aria-checked');
        if (initialAriaChecked === 'true') {
          expect(updatedAriaChecked).toBe('false');
        } else {
          expect(updatedAriaChecked).toBe('true');
        }
      });

      test(`[${name}] tap complete then tap again toggles status back`, async ({ page }) => {
        const firstCompleteBtn = page.getByTestId('task-complete-btn').first();
        await firstCompleteBtn.tap();
        const afterFirstTap = await firstCompleteBtn.getAttribute('aria-checked');
        await firstCompleteBtn.tap();
        const afterSecondTap = await firstCompleteBtn.getAttribute('aria-checked');
        expect(afterFirstTap).not.toBe(afterSecondTap);
      });

      test(`[${name}] swipe-to-delete reveals delete button on task card`, async ({ page }) => {
        const firstCard = page.getByTestId('task-card').first();
        const cardBox = await firstCard.boundingBox();
        expect(cardBox).not.toBeNull();

        const startX = cardBox!.x + cardBox!.width * 0.8;
        const startY = cardBox!.y + cardBox!.height / 2;
        const endX = cardBox!.x + cardBox!.width * 0.1;

        await page.touchscreen.tap(startX, startY);
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, startY, { steps: 20 });
        await page.mouse.up();

        await expect(page.getByTestId('task-delete-btn').first()).toBeVisible();
      });

      test(`[${name}] swipe-to-delete and tapping delete removes the task`, async ({ page }) => {
        const taskList = page.getByTestId('task-list');
        const initialCount = await page.getByTestId('task-card').count();
        expect(initialCount).toBeGreaterThan(0);

        const firstCard = page.getByTestId('task-card').first();
        const cardBox = await firstCard.boundingBox();
        expect(cardBox).not.toBeNull();

        const startX = cardBox!.x + cardBox!.width * 0.8;
        const startY = cardBox!.y + cardBox!.height / 2;
        const endX = cardBox!.x + cardBox!.width * 0.1;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, startY, { steps: 20 });
        await page.mouse.up();

        await page.getByTestId('task-delete-btn').first().tap();
        await taskList.waitFor({ state: 'visible' });

        const newCount = await page.getByTestId('task-card').count();
        expect(newCount).toBe(initialCount - 1);
      });

      test(`[${name}] long-press on task card triggers contextual action`, async ({ page }) => {
        const firstCard = page.getByTestId('task-card').first();
        const cardBox = await firstCard.boundingBox();
        expect(cardBox).not.toBeNull();

        const centerX = cardBox!.x + cardBox!.width / 2;
        const centerY = cardBox!.y + cardBox!.height / 2;

        await page.touchscreen.tap(centerX, centerY);
        await page.waitForTimeout(800);
        await page.touchscreen.tap(centerX, centerY);

        const deleteBtn = page.getByTestId('task-delete-btn').first();
        const editBtn = page.getByTestId('task-edit-btn').first();
        const eitherVisible = (await deleteBtn.isVisible()) || (await editBtn.isVisible());
        expect(eitherVisible).toBe(true);
      });

      test(`[${name}] tap on add-task-btn opens task creation form`, async ({ page }) => {
        await page.getByTestId('add-task-btn').tap();
        await expect(page.getByTestId('task-form')).toBeVisible();
        await expect(page.getByTestId('title-input')).toBeVisible();
        await expect(page.getByTestId('description-input')).toBeVisible();
        await expect(page.getByTestId('priority-select')).toBeVisible();
        await expect(page.getByTestId('save-task-btn')).toBeVisible();
      });

      test(`[${name}] tap inputs in task form and submit creates new task`, async ({ page }) => {
        await page.getByTestId('add-task-btn').tap();
        await page.getByTestId('task-form').waitFor({ state: 'visible' });

        await page.getByTestId('title-input').tap();
        await page.getByTestId('title-input').fill('New Touch Task');

        await page.getByTestId('description-input').tap();
        await page.getByTestId('description-input').fill('Created via touch test');

        await page.getByTestId('priority-select').tap();
        await page.getByRole('option', { name: 'High' }).tap();

        const initialCount = await page.getByTestId('task-card').count();
        await page.getByTestId('save-task-btn').tap();
        await page.getByTestId('task-list').waitFor({ state: 'visible' });

        const newCount = await page.getByTestId('task-card').count();
        expect(newCount).toBe(initialCount + 1);

        const lastCard = page.getByTestId('task-card').last();
        await expect(lastCard.getByTestId('task-title')).toHaveText('New Touch Task');
      });

      test(`[${name}] tap does not trigger hover state that breaks layout`, async ({ page }) => {
        const firstCard = page.getByTestId('task-card').first();
        const cardBoxBefore = await firstCard.boundingBox();
        expect(cardBoxBefore).not.toBeNull();

        await page.getByTestId('task-complete-btn').first().tap();
        await page.waitForTimeout(300);

        const taskList = page.getByTestId('task-list');
        const listBox = await taskList.boundingBox();
        expect(listBox).not.toBeNull();
        expect(listBox!.width).toBeGreaterThan(0);
        expect(listBox!.height).toBeGreaterThan(0);

        const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflowX).toBe(false);
      });

      test(`[${name}] no horizontal overflow after tapping interactive elements`, async ({ page }) => {
        await page.getByTestId('task-card').first().tap();
        await page.getByTestId('task-form').waitFor({ state: 'visible' });

        const overflowX = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        );
        expect(overflowX).toBe(false);
      });

      test(`[${name}] tap on logout-btn logs user out and redirects to login`, async ({ page }) => {
        await page.getByTestId('logout-btn').tap();
        await expect(page.getByTestId('login-btn')).toBeVisible();
        await expect(page.getByTestId('email-input')).toBeVisible();
        await expect(page.getByTestId('password-input')).toBeVisible();
      });

      test(`[${name}] all task-card elements maintain touch target sizes after list scroll`, async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);

        const completeButtons = page.getByTestId('task-complete-btn');
        const count = await completeButtons.count();

        for (let i = 0; i < Math.min(count, 3); i++) {
          const rect = await completeButtons.nth(i).boundingBox();
          expect(rect).not.toBeNull();
          expect(rect!.width).toBeGreaterThanOrEqual(44);
          expect(rect!.height).toBeGreaterThanOrEqual(44);
        }
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────

test.describe('Mobile — Forms', () => {
  test.describe('iPhone 13 — Form UX', () => {
    test.use({ ...devices['iPhone 13'] });

    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:3000');
    });

    test('email input has correct type and inputmode for email keyboard', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      await expect(emailInput).toBeVisible();

      const inputType = await emailInput.getAttribute('type');
      const inputMode = await emailInput.getAttribute('inputmode');

      expect(
        inputType === 'email' || inputMode === 'email'
      ).toBeTruthy();

      if (inputType) {
        expect(inputType).toBe('email');
      }
      if (inputMode) {
        expect(inputMode).toBe('email');
      }
    });

    test('password input is masked and has show/hide toggle', async ({ page }) => {
      const passwordInput = page.getByTestId('password-input');
      await expect(passwordInput).toBeVisible();

      const inputType = await passwordInput.getAttribute('type');
      expect(inputType).toBe('password');

      await passwordInput.tap();
      await passwordInput.fill('TestPassword123');

      const maskedType = await passwordInput.getAttribute('type');
      expect(maskedType).toBe('password');

      const showHideToggle = page.getByRole('button', { name: /show|hide|toggle|eye/i });
      const toggleByTestId = page.getByTestId('password-toggle');

      const toggleVisible =
        (await showHideToggle.count()) > 0 ||
        (await toggleByTestId.count()) > 0;

      expect(toggleVisible).toBeTruthy();

      if (await showHideToggle.count() > 0) {
        await showHideToggle.first().tap();
        const revealedType = await passwordInput.getAttribute('type');
        expect(revealedType).toBe('text');

        await showHideToggle.first().tap();
        const remaskedType = await passwordInput.getAttribute('type');
        expect(remaskedType).toBe('password');
      } else if (await toggleByTestId.count() > 0) {
        await toggleByTestId.tap();
        const revealedType = await passwordInput.getAttribute('type');
        expect(revealedType).toBe('text');

        await toggleByTestId.tap();
        const remaskedType = await passwordInput.getAttribute('type');
        expect(remaskedType).toBe('password');
      }
    });

    test('autocomplete attributes are set correctly on email and password inputs', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      const passwordInput = page.getByTestId('password-input');

      await expect(emailInput).toBeVisible();
      await expect(passwordInput).toBeVisible();

      const emailAutocomplete = await emailInput.getAttribute('autocomplete');
      expect(emailAutocomplete).toBe('email');

      const passwordAutocomplete = await passwordInput.getAttribute('autocomplete');
      expect(passwordAutocomplete).toBe('current-password');
    });

    test('date input shows native date picker attributes on mobile', async ({ page }) => {
      await page.goto('http://localhost:3000/tasks/new');

      const dateInput = page.getByRole('textbox', { name: /date/i });
      const dateInputByType = page.locator('input[type="date"]');

      const hasDateInput =
        (await dateInput.count()) > 0 ||
        (await dateInputByType.count()) > 0;

      if (hasDateInput) {
        const targetInput = (await dateInput.count()) > 0 ? dateInput.first() : dateInputByType.first();
        await expect(targetInput).toBeVisible();

        const type = await targetInput.getAttribute('type');
        expect(type).toBe('date');

        const readOnly = await targetInput.getAttribute('readonly');
        const disabled = await targetInput.getAttribute('disabled');
        expect(disabled).toBeNull();
      } else {
        test.skip();
      }
    });

    test('form validation messages are visible and not clipped', async ({ page }) => {
      const loginBtn = page.getByTestId('login-btn');
      await expect(loginBtn).toBeVisible();

      await loginBtn.tap();

      const emailInput = page.getByTestId('email-input');
      const passwordInput = page.getByTestId('password-input');

      await expect(emailInput).toBeVisible();

      const emailValidation = await emailInput.evaluate((el: HTMLInputElement) => ({
        validity: el.validity.valid,
        validationMessage: el.validationMessage,
      }));

      if (!emailValidation.validity) {
        expect(emailValidation.validationMessage.length).toBeGreaterThan(0);
      }

      const validationMessages = page.getByRole('alert');
      const errorMessages = page.locator('[aria-live="polite"], [aria-live="assertive"]');
      const inlineErrors = page.locator('[data-testid*="error"], [data-testid*="validation"]');

      const hasValidationFeedback =
        (await validationMessages.count()) > 0 ||
        (await errorMessages.count()) > 0 ||
        (await inlineErrors.count()) > 0 ||
        !emailValidation.validity;

      expect(hasValidationFeedback).toBeTruthy();

      if (await validationMessages.count() > 0) {
        const firstAlert = validationMessages.first();
        const box = await firstAlert.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
        }
      }
    });

    test('submit button is not covered by virtual keyboard after scroll', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      await emailInput.tap();
      await emailInput.fill('test@example.com');

      const passwordInput = page.getByTestId('password-input');
      await passwordInput.tap();
      await passwordInput.fill('password123');

      const loginBtn = page.getByTestId('login-btn');
      await loginBtn.scrollIntoViewIfNeeded();

      await expect(loginBtn).toBeVisible();

      const box = await loginBtn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Pixel 5 — Form Submission', () => {
    test.use({ ...devices['Pixel 5'] });

    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:3000');
    });

    test('form submission by filling and submitting all fields on Pixel 5', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      const passwordInput = page.getByTestId('password-input');
      const loginBtn = page.getByTestId('login-btn');

      await expect(emailInput).toBeVisible();
      await expect(passwordInput).toBeVisible();
      await expect(loginBtn).toBeVisible();

      await emailInput.tap();
      await emailInput.fill('testuser@example.com');

      await passwordInput.tap();
      await passwordInput.fill('SecurePass123!');

      await loginBtn.scrollIntoViewIfNeeded();
      await expect(loginBtn).toBeVisible();

      await loginBtn.tap();

      await page.waitForTimeout(1000);

      const isOnDashboard =
        (await page.getByTestId('task-list').count()) > 0 ||
        (await page.getByTestId('add-task-btn').count()) > 0 ||
        (await page.getByTestId('logout-btn').count()) > 0;

      const hasError =
        (await page.getByRole('alert').count()) > 0 ||
        (await page.locator('[data-testid*="error"]').count()) > 0;

      expect(isOnDashboard || hasError).toBeTruthy();
    });

    test('task form fills and submits correctly on Pixel 5', async ({ page }) => {
      await page.goto('http://localhost:3000/tasks/new');

      const taskForm = page.getByTestId('task-form');
      const formExists = await taskForm.count() > 0;

      if (!formExists) {
        const addTaskBtn = page.getByTestId('add-task-btn');
        if (await addTaskBtn.count() > 0) {
          await addTaskBtn.tap();
          await page.waitForTimeout(500);
        } else {
          test.skip();
          return;
        }
      }

      const titleInput = page.getByTestId('title-input');
      const descriptionInput = page.getByTestId('description-input');
      const prioritySelect = page.getByTestId('priority-select');
      const saveTaskBtn = page.getByTestId('save-task-btn');

      await expect(titleInput).toBeVisible();

      await titleInput.tap();
      await titleInput.fill('Mobile Test Task');

      if (await descriptionInput.count() > 0) {
        await descriptionInput.tap();
        await descriptionInput.fill('This is a task created from Pixel 5 emulation test');
      }

      if (await prioritySelect.count() > 0) {
        await expect(prioritySelect).toBeVisible();
        await prioritySelect.selectOption({ index: 1 });
      }

      await expect(saveTaskBtn).toBeVisible();
      await saveTaskBtn.scrollIntoViewIfNeeded();

      const saveBox = await saveTaskBtn.boundingBox();
      expect(saveBox).not.toBeNull();
      if (saveBox) {
        expect(saveBox.width).toBeGreaterThan(0);
        expect(saveBox.height).toBeGreaterThan(0);
      }

      await saveTaskBtn.tap();
      await page.waitForTimeout(1000);

      const successIndicator =
        (await page.getByTestId('task-list').count()) > 0 ||
        (await page.getByTestId('task-card').count()) > 0 ||
        (await page.getByTestId('task-title').count()) > 0 ||
        page.url().includes('/tasks') ||
        page.url() === 'http://localhost:3000/';

      expect(successIndicator).toBeTruthy();
    });

    test('email keyboard inputmode is correct on Pixel 5', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      await expect(emailInput).toBeVisible();

      const inputType = await emailInput.getAttribute('type');
      const inputMode = await emailInput.getAttribute('inputmode');

      expect(
        inputType === 'email' || inputMode === 'email'
      ).toBeTruthy();
    });

    test('form validation messages are visible on Pixel 5', async ({ page }) => {
      const loginBtn = page.getByTestId('login-btn');
      await expect(loginBtn).toBeVisible();
      await loginBtn.tap();

      await page.waitForTimeout(500);

      const emailInput = page.getByTestId('email-input');
      const emailValidation = await emailInput.evaluate((el: HTMLInputElement) => ({
        validity: el.validity.valid,
        validationMessage: el.validationMessage,
      }));

      const hasAlerts = await page.getByRole('alert').count() > 0;
      const hasLiveRegions = await page.locator('[aria-live]').count() > 0;
      const hasInlineErrors = await page.locator('[data-testid*="error"]').count() > 0;
      const hasNativeValidation = !emailValidation.validity;

      expect(
        hasAlerts || hasLiveRegions || hasInlineErrors || hasNativeValidation
      ).toBeTruthy();

      if (hasAlerts) {
        const alerts = page.getByRole('alert');
        const count = await alerts.count();
        for (let i = 0; i < count; i++) {
          const alertBox = await alerts.nth(i).boundingBox();
          if (alertBox) {
            expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(393 + 1);
            expect(alertBox.width).toBeGreaterThan(0);
          }
        }
      }
    });

    test('submit button scrolls into view and is tappable on Pixel 5', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      await emailInput.tap();
      await emailInput.fill('user@test.com');

      const loginBtn = page.getByTestId('login-btn');
      await loginBtn.scrollIntoViewIfNeeded();

      await expect(loginBtn).toBeVisible();
      await expect(loginBtn).toBeEnabled();

      const box = await loginBtn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThan(44);
        expect(box.height).toBeGreaterThan(44);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(851 + 1);
      }
    });

    test('autocomplete attributes present on Pixel 5', async ({ page }) => {
      const emailInput = page.getByTestId('email-input');
      const passwordInput = page.getByTestId('password-input');

      await expect(emailInput).toBeVisible();
      await expect(passwordInput).toBeVisible();

      const emailAutocomplete = await emailInput.getAttribute('autocomplete');
      expect(emailAutocomplete).toBe('email');

      const passwordAutocomplete = await passwordInput.getAttribute('autocomplete');
      expect(passwordAutocomplete).toBe('current-password');
    });
  });
});