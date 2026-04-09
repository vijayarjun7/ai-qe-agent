import { test, expect, Page, BrowserContext } from '@playwright/test';

// ─── Page Object Model ────────────────────────────────────────────────────────

class LoginPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('http://localhost:3000/login');
  }

  async waitForReady() {
    await expect(this.page.getByTestId('email-input')).toBeVisible();
    await expect(this.page.getByTestId('password-input')).toBeVisible();
    await expect(this.page.getByTestId('login-btn')).toBeVisible();
  }

  async fillEmail(email: string) {
    await this.page.getByTestId('email-input').fill(email);
    await expect(this.page.getByTestId('email-input')).toHaveValue(email);
  }

  async fillPassword(password: string) {
    await this.page.getByTestId('password-input').fill(password);
    await expect(this.page.getByTestId('password-input')).toHaveValue(password);
  }

  async clickLoginButton() {
    await this.page.getByTestId('login-btn').click();
  }

  async login(email: string, password: string) {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickLoginButton();
  }

  async getErrorMessage() {
    return this.page.getByTestId('login-error');
  }

  async isOnLoginPage() {
    return this.page.url().includes('/login');
  }
}

class DashboardPage {
  constructor(private page: Page) {}

  async waitForReady() {
    await expect(this.page).toHaveURL(/\/dashboard/);
    await expect(this.page.getByTestId('task-list')).toBeVisible();
  }

  async clickAddTask() {
    await this.page.getByTestId('add-task-btn').click();
    await expect(this.page.getByTestId('task-form')).toBeVisible();
  }

  async fillTitle(title: string) {
    await this.page.getByTestId('title-input').fill(title);
    await expect(this.page.getByTestId('title-input')).toHaveValue(title);
  }

  async clearTitle() {
    await this.page.getByTestId('title-input').clear();
    await expect(this.page.getByTestId('title-input')).toHaveValue('');
  }

  async fillDescription(description: string) {
    await this.page.getByTestId('description-input').fill(description);
    await expect(this.page.getByTestId('description-input')).toHaveValue(description);
  }

  async selectPriority(priority: string) {
    await this.page.getByTestId('priority-select').selectOption(priority);
    await expect(this.page.getByTestId('priority-select')).toHaveValue(priority);
  }

  async fillDueDate(date: string) {
    await this.page.getByTestId('due-date-input').fill(date);
    await expect(this.page.getByTestId('due-date-input')).toHaveValue(date);
  }

  async clickSaveTask() {
    await this.page.getByTestId('save-task-btn').click();
  }

  async getTaskCards() {
    return this.page.getByTestId('task-card');
  }

  async findTaskByTitle(title: string) {
    return this.page.getByTestId('task-card').filter({ hasText: title });
  }

  async clickEditOnTask(title: string) {
    const card = this.page.getByTestId('task-card').filter({ hasText: title });
    await card.getByTestId('task-edit-btn').click();
    await expect(this.page.getByTestId('task-form')).toBeVisible();
  }

  async createTask(options: {
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
  }) {
    await this.clickAddTask();
    if (options.title) {
      await this.fillTitle(options.title);
    }
    if (options.description) {
      await this.fillDescription(options.description);
    }
    if (options.priority) {
      await this.selectPriority(options.priority);
    }
    if (options.dueDate) {
      await this.fillDueDate(options.dueDate);
    }
    await this.clickSaveTask();
  }

  async reload() {
    await this.page.reload();
    await this.waitForReady();
  }

  async getTokenFromStorage(context: BrowserContext): Promise<string | null> {
    const storageState = await context.storageState();
    for (const origin of storageState.origins) {
      for (const item of origin.localStorage) {
        if (item.name === 'token' || item.name.toLowerCase().includes('token')) {
          return item.value;
        }
      }
    }
    return null;
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';
const VALID_EMAIL = 'test@example.com';
const VALID_PASSWORD = 'Test123!';

async function loginAndGoToDashboard(page: Page): Promise<DashboardPage> {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.waitForReady();
  await loginPage.login(VALID_EMAIL, VALID_PASSWORD);
  const dashboard = new DashboardPage(page);
  await dashboard.waitForReady();
  return dashboard;
}

async function getTokenFromStorage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (key.toLowerCase().includes('token') && value) return value;
    }
    const sessionKeys = Object.keys(sessionStorage);
    for (const key of sessionKeys) {
      const value = sessionStorage.getItem(key);
      if (key.toLowerCase().includes('token') && value) return value;
    }
    return null;
  });
}

async function hasNoTokenInStorage(page: Page): Promise<boolean> {
  const token = await page.evaluate(() => {
    const lsKeys = Object.keys(localStorage);
    for (const key of lsKeys) {
      if (key.toLowerCase().includes('token')) return false;
    }
    const ssKeys = Object.keys(sessionStorage);
    for (const key of ssKeys) {
      if (key.toLowerCase().includes('token')) return false;
    }
    return true;
  });
  return token;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('TC-001: Successful login with valid credentials', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.navigate();
    awai