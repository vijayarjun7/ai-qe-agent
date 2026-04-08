import { chromium, Browser, Page } from '@playwright/test';
import { logger } from '../utils/Logger';

export interface PageElement {
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  label?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  testId?: string;
  selector: string;
}

export interface PageAnalysis {
  url: string;
  title: string;
  description: string;
  forms: FormInfo[];
  buttons: PageElement[];
  links: PageElement[];
  inputs: PageElement[];
  headings: string[];
  tables: TableInfo[];
  alerts: string[];
  rawHTML: string;
}

export interface FormInfo {
  id?: string;
  name?: string;
  action?: string;
  method?: string;
  fields: PageElement[];
  submitButton?: PageElement;
}

export interface TableInfo {
  id?: string;
  caption?: string;
  headers: string[];
  rowCount: number;
}

export class PageAnalyzer {
  private browser?: Browser;

  async analyze(url: string): Promise<PageAnalysis> {
    logger.info(`🔍 Analyzing page: ${url}`);
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (compatible; AI-QE-Agent/1.0; +https://github.com/ai-qe-agent)',
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500); // Allow dynamic content to settle

      const analysis = await page.evaluate((): Omit<PageAnalysis, 'url' | 'rawHTML'> => {
        const getSelector = (el: Element): string => {
          if (el.id) return `#${el.id}`;
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
          if (testId) return `[data-testid="${testId}"]`;
          const name = el.getAttribute('name');
          if (name) return `[name="${name}"]`;
          const role = el.getAttribute('role');
          const ariaLabel = el.getAttribute('aria-label');
          if (role && ariaLabel) return `[role="${role}"][aria-label="${ariaLabel}"]`;
          // Fallback: tag + class
          const tag = el.tagName.toLowerCase();
          const classes = Array.from(el.classList)
            .slice(0, 2)
            .join('.');
          return classes ? `${tag}.${classes}` : tag;
        };

        const mapEl = (el: Element): PageElement => ({
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type || undefined,
          id: el.id || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          label:
            (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
            el.getAttribute('aria-label') ||
            undefined,
          text: el.textContent?.trim().substring(0, 80) || undefined,
          role: el.getAttribute('role') || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          testId:
            el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined,
          selector: getSelector(el),
        });

        // Forms
        const forms: FormInfo[] = Array.from(
          document.querySelectorAll('form')
        ).map((form) => {
          const fields = Array.from(
            form.querySelectorAll('input:not([type="hidden"]), textarea, select')
          ).map(mapEl);
          const submitBtn = form.querySelector(
            '[type="submit"], button:not([type="button"])'
          );
          return {
            id: form.id || undefined,
            name: form.getAttribute('name') || undefined,
            action: form.action || undefined,
            method: form.method || undefined,
            fields,
            submitButton: submitBtn ? mapEl(submitBtn) : undefined,
          };
        });

        // Buttons
        const buttons = Array.from(
          document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')
        ).slice(0, 30).map(mapEl);

        // Links
        const links = Array.from(document.querySelectorAll('a[href]'))
          .filter((a) => {
            const href = (a as HTMLAnchorElement).href;
            return href && !href.startsWith('javascript:') && !href.startsWith('mailto:');
          })
          .slice(0, 20)
          .map(mapEl);

        // Inputs (outside forms)
        const inputs = Array.from(
          document.querySelectorAll('input:not([type="hidden"]), textarea, select')
        )
          .filter((el) => !el.closest('form'))
          .slice(0, 20)
          .map(mapEl);

        // Headings
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .map((h) => h.textContent?.trim() || '')
          .filter(Boolean)
          .slice(0, 10);

        // Tables
        const tables: TableInfo[] = Array.from(
          document.querySelectorAll('table')
        ).map((table) => ({
          id: table.id || undefined,
          caption: table.querySelector('caption')?.textContent?.trim() || undefined,
          headers: Array.from(table.querySelectorAll('th')).map(
            (th) => th.textContent?.trim() || ''
          ),
          rowCount: table.querySelectorAll('tbody tr').length,
        }));

        // Alerts / notifications
        const alerts = Array.from(
          document.querySelectorAll('[role="alert"], .alert, .notification, .toast, .error-message')
        )
          .map((el) => el.textContent?.trim() || '')
          .filter(Boolean);

        return {
          title: document.title,
          description:
            document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          forms,
          buttons,
          links,
          inputs,
          headings,
          tables,
          alerts,
        };
      });

      const rawHTML = await page.content();

      logger.info(
        `✅ Page analyzed — ${analysis.forms.length} forms, ${analysis.buttons.length} buttons, ${analysis.links.length} links`
      );

      return { url, rawHTML: rawHTML.substring(0, 10000), ...analysis };
    } finally {
      await this.browser.close();
    }
  }
}
