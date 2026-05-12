"""
AI QE Agent — Gradio Demo
Playwright TypeScript test generator + self-healing locator demo
Powered by Claude AI  |  github.com/vijayarjun7/ai-qe-agent
"""

import re
import gradio as gr
import anthropic

# ── Prompts (mirrored from TypeScript agent) ──────────────────────────────────

SYSTEM_PROMPT_TEST_GEN = """You are an expert QA automation engineer specializing in Playwright with TypeScript.
Your job is to generate production-ready, maintainable E2E test suites.

Rules:
- Always use Playwright's recommended locators: getByRole, getByLabel, getByPlaceholder, getByText, getByTestId — prefer these over CSS/XPath selectors.
- Use the Page Object Model (POM) pattern when there are 5+ interactions.
- Every test must have a descriptive name following the pattern: "should <action> when <condition>".
- Use test.describe() to group related tests.
- Include beforeEach/afterEach hooks where appropriate.
- Add expect() assertions after every meaningful action.
- Handle async/await properly — every Playwright call must be awaited.
- Add comments explaining the test intent.
- Do NOT use deprecated Playwright APIs.
- Output ONLY valid TypeScript code, no markdown, no explanation text."""

HEALING_SYSTEM_PROMPT = """You are an expert Playwright automation engineer specializing in self-healing test selectors.
When given a broken test file, your job is to:
1. Identify which selectors are fragile or likely broken (CSS class names, auto-generated IDs)
2. Replace them with robust semantic Playwright locators
3. Prefer: getByRole > getByLabel > getByTestId > getByText > getByPlaceholder > CSS selectors
4. Return ONLY the fully corrected TypeScript test file, no explanations."""

# ── Static self-healing before/after example ─────────────────────────────────

BROKEN_EXAMPLE = """\
import { test, expect } from "@playwright/test";

test.describe("TaskMaster — Login", () => {
  test("should login with valid credentials", async ({ page }) => {
    await page.goto("/login");

    // ❌ Fragile CSS selectors — break when class names or IDs change
    await page.locator(".input-field-email-v2").fill("user@example.com");
    await page.locator("#pwd-input-field").fill("password123");
    await page.locator(".btn-primary.submit-action").click();

    await expect(page.locator(".dashboard-header-msg")).toBeVisible();
  });

  test("should display error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.locator(".input-field-email-v2").fill("wrong@example.com");
    await page.locator("#pwd-input-field").fill("badpassword");
    await page.locator(".btn-primary.submit-action").click();

    // ❌ CSS class-based error detection — silently misses errors if class changes
    await expect(page.locator(".error-msg-container")).toBeVisible();
    await expect(page.locator(".error-msg-container"))
      .toContainText("Invalid");
  });

  test("should redirect to login when accessing dashboard unauthenticated",
    async ({ page }) => {
      await page.goto("/dashboard");
      // ❌ XPath — brittle, unreadable
      await expect(
        page.locator("xpath=//div[@class='login-form-wrapper']")
      ).toBeVisible();
    }
  );
});"""

HEALED_EXAMPLE = """\
import { test, expect } from "@playwright/test";

test.describe("TaskMaster — Login", () => {
  test("should login with valid credentials", async ({ page }) => {
    await page.goto("/login");

    // ✅ Semantic locators — resilient to DOM/style refactors
    await page.getByTestId("email-input").fill("user@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByTestId("login-btn").click();

    await expect(page).toHaveURL(/dashboard/);
  });

  test("should display error for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("email-input").fill("wrong@example.com");
    await page.getByTestId("password-input").fill("badpassword");
    await page.getByTestId("login-btn").click();

    // ✅ Role-based — tied to semantic meaning, not styling
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page.getByTestId("login-error"))
      .toContainText(/invalid|incorrect/i);
  });

  test("should redirect to login when accessing dashboard unauthenticated",
    async ({ page }) => {
      await page.goto("/dashboard");
      // ✅ URL assertion — verifies behaviour, not DOM structure
      await expect(page).toHaveURL(/login/);
    }
  );
});"""

# ── Example inputs ─────────────────────────────────────────────────────────────

EXAMPLES = [
    [
        "As a registered user, I want to log into the TaskMaster app using my email and password so I can access my personal task dashboard.",
        "Login",
    ],
    [
        "https://practicetestautomation.com/practice-test-login/",
        "Login",
    ],
    [
        "As a new user, I want to register by entering my full name, email, and a password (min 6 chars) so I can create my TaskMaster account.",
        "Form",
    ],
    [
        "As a task owner, I want to create a task with title, description, priority (low/medium/high), and optional due date, then see it appear in my dashboard list.",
        "Form",
    ],
    [
        "As a shopper, I want to browse product categories, filter by price range, and navigate to individual product detail pages to read reviews.",
        "Navigation",
    ],
    [
        "Test the TaskMaster REST API: POST /api/auth/register, POST /api/auth/login, GET /api/tasks (with JWT), POST /api/tasks, PUT /api/tasks/:id, DELETE /api/tasks/:id.",
        "API",
    ],
]

# ── Core logic ────────────────────────────────────────────────────────────────

def _make_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key.strip())


def _clean_code(raw: str) -> str:
    """Strip accidental markdown fences Claude occasionally emits."""
    raw = re.sub(r"^```(?:typescript|ts)?\s*\n?", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\n?```\s*$", "", raw, flags=re.MULTILINE)
    return raw.strip()


def _build_test_prompt(input_text: str, test_type: str) -> str:
    focus = {
        "Login": (
            "Cover: valid/invalid credentials, empty fields, error messages, "
            "password visibility toggle, forgot-password link, "
            "'remember me' checkbox, redirect after login, session persistence."
        ),
        "Form": (
            "Cover: required field validation, format validation (email, phone, date), "
            "min/max length, submission success and failure, "
            "error message display, multi-step forms, reset/cancel behaviour."
        ),
        "Navigation": (
            "Cover: top-level nav links, breadcrumbs, active menu state, "
            "404 handling, browser back/forward, deep links, "
            "redirect rules, anchor links."
        ),
        "API": (
            "Cover: successful CRUD operations, authentication headers (Bearer token), "
            "validation errors (400), auth errors (401), not-found (404), "
            "response body schema, pagination, concurrent requests."
        ),
    }.get(test_type, "Cover all relevant functionality comprehensively.")

    is_url = input_text.startswith("http://") or input_text.startswith("https://")

    if is_url:
        return f"""\
Generate a comprehensive Playwright TypeScript test suite for this URL:
{input_text}

TEST TYPE: {test_type}
FOCUS: {focus}

REQUIREMENTS:
- 6–8 meaningful test cases (happy path, edge cases, negative scenarios)
- Page Object Model pattern
- Use relative paths ('/login', '/dashboard') — baseURL is set in playwright.config.ts
- All locators must be semantic (getByRole, getByLabel, getByTestId, getByText)
- Descriptive test names: "should <action> when <condition>"

Output ONLY valid TypeScript."""
    else:
        return f"""\
Generate a comprehensive Playwright TypeScript test suite from these requirements:

{input_text}

TEST TYPE: {test_type}
FOCUS: {focus}

BASE URL: https://example.com  (use relative paths like '/login')

REQUIREMENTS:
- 6–8 meaningful test cases (happy path, edge cases, negative scenarios)
- Page Object Model pattern
- All locators must be semantic (getByRole, getByLabel, getByTestId, getByText)
- Descriptive test names: "should <action> when <condition>"

Output ONLY valid TypeScript."""


def generate_tests(api_key: str, input_text: str, test_type: str) -> str:
    if not api_key.strip():
        return "⚠️  Enter your Anthropic API key in the settings panel above."
    if not input_text.strip():
        return "⚠️  Enter a URL or user story to generate tests."

    try:
        client = _make_client(api_key)
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=SYSTEM_PROMPT_TEST_GEN,
            messages=[{"role": "user", "content": _build_test_prompt(input_text.strip(), test_type)}],
        )
        return _clean_code(response.content[0].text)

    except anthropic.AuthenticationError:
        return "❌ Invalid API key — check your key at console.anthropic.com."
    except anthropic.RateLimitError:
        return "❌ Rate limit reached — wait a moment then retry."
    except anthropic.APIStatusError as e:
        return f"❌ API error {e.status_code}: {e.message}"
    except Exception as e:
        return f"❌ Unexpected error: {e}"


def heal_selectors(api_key: str, broken_code: str) -> str:
    if not api_key.strip():
        return "⚠️  Enter your Anthropic API key in the settings panel above."
    if not broken_code.strip():
        return "⚠️  Paste a Playwright test file with broken/fragile selectors."

    prompt = f"""\
Heal the broken selectors in this Playwright TypeScript test.
Replace ALL fragile CSS class/ID selectors and XPath with semantic Playwright locators
(getByRole, getByLabel, getByTestId, getByText, getByPlaceholder).

BROKEN TEST:
{broken_code}

Return ONLY the corrected TypeScript file — no markdown, no explanations."""

    try:
        client = _make_client(api_key)
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=HEALING_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return _clean_code(response.content[0].text)

    except anthropic.AuthenticationError:
        return "❌ Invalid API key — check your key at console.anthropic.com."
    except anthropic.RateLimitError:
        return "❌ Rate limit reached — wait a moment then retry."
    except anthropic.APIStatusError as e:
        return f"❌ API error {e.status_code}: {e.message}"
    except Exception as e:
        return f"❌ Unexpected error: {e}"


# ── Gradio UI ─────────────────────────────────────────────────────────────────

_HEADER = """
# 🤖 AI QE Agent — Playwright Test Generator

Auto-generate production-ready **Playwright TypeScript** tests from a URL or plain-English user story.
Powered by **Claude AI** · Built on the [ai-qe-agent](https://github.com/vijayarjun7/ai-qe-agent) framework.
"""

_API_KEY_NOTE = """
**Get your key:** [console.anthropic.com](https://console.anthropic.com) → API Keys
Your key is sent directly to the Anthropic API and is never stored.
"""

_HOW_HEALING_WORKS = """
## How Self-Healing Works

CSS class names and auto-generated IDs change whenever a UI is redesigned or a component library is updated —
causing tests to silently break. The AI QE Agent detects brittle selectors and replaces them with
**semantic Playwright locators** that are anchored to the page's _meaning_, not its styling.

**Locator hierarchy (most → least preferred)**
`getByRole` → `getByLabel` → `getByTestId` → `getByText` → `getByPlaceholder` → CSS
"""

with gr.Blocks(theme=gr.themes.Soft(), title="AI QE Agent") as demo:

    gr.Markdown(_HEADER)

    # ── API key (shared across both tabs) ─────────────────────────────────────
    with gr.Accordion("🔑 API Key Settings", open=True):
        gr.Markdown(_API_KEY_NOTE)
        api_key = gr.Textbox(
            label="Anthropic API Key",
            placeholder="sk-ant-api03-...",
            type="password",
        )

    with gr.Tabs():

        # ── Tab 1 · Test Generator ─────────────────────────────────────────────
        with gr.TabItem("🧪 Test Generator"):
            gr.Markdown(
                "Enter a **URL** (e.g. `https://example.com/login`) or a "
                "**user story** — the agent generates a full Playwright TypeScript test suite."
            )

            with gr.Row(equal_height=True):
                with gr.Column(scale=3):
                    user_input = gr.Textbox(
                        label="URL or User Story",
                        placeholder=(
                            "https://example.com/login\n\n"
                            "— or —\n\n"
                            "As a registered user, I want to log in with my email "
                            "and password so I can access my dashboard."
                        ),
                        lines=6,
                    )
                with gr.Column(scale=1):
                    test_type = gr.Dropdown(
                        label="Test Type",
                        choices=["Login", "Form", "Navigation", "API"],
                        value="Login",
                    )
                    gen_btn = gr.Button("⚡ Generate Tests", variant="primary", size="lg")

            gr.Examples(
                examples=EXAMPLES,
                inputs=[user_input, test_type],
                label="📋 Example Inputs — click any row to load",
                examples_per_page=6,
            )

            output = gr.Code(
                label="Generated Playwright Test · TypeScript",
                language="typescript",
                lines=35,
            )

            gen_btn.click(
                fn=generate_tests,
                inputs=[api_key, user_input, test_type],
                outputs=output,
            )

        # ── Tab 2 · Self-Healing Demo ──────────────────────────────────────────
        with gr.TabItem("🔧 Self-Healing Demo"):
            gr.Markdown(_HOW_HEALING_WORKS)

            # Static before/after
            with gr.Row(equal_height=True):
                with gr.Column():
                    gr.Markdown("### ❌ Before — Fragile CSS / XPath Selectors")
                    gr.Code(
                        value=BROKEN_EXAMPLE,
                        language="typescript",
                        label="Breaks when class names or IDs change",
                        interactive=False,
                        lines=30,
                    )
                with gr.Column():
                    gr.Markdown("### ✅ After — Self-Healed Semantic Locators")
                    gr.Code(
                        value=HEALED_EXAMPLE,
                        language="typescript",
                        label="Resilient to DOM / style refactors",
                        interactive=False,
                        lines=30,
                    )

            gr.Markdown("---\n### 🛠️ Try It — Heal Your Own Broken Test")
            gr.Markdown(
                "Paste a Playwright test that uses CSS class selectors, numeric IDs, "
                "or XPath — the agent will upgrade every selector to a semantic locator."
            )

            broken_input = gr.Code(
                label="Paste broken Playwright test here",
                language="typescript",
                lines=18,
                placeholder="// Paste your .spec.ts file...",
            )
            heal_btn = gr.Button("🔧 Heal Selectors with Claude AI", variant="primary")
            healed_output = gr.Code(
                label="Healed Test Output",
                language="typescript",
                lines=18,
            )

            heal_btn.click(
                fn=heal_selectors,
                inputs=[api_key, broken_input],
                outputs=healed_output,
            )

    # ── Footer ─────────────────────────────────────────────────────────────────
    gr.Markdown(
        "---\n"
        "**Built with** [ai-qe-agent](https://github.com/vijayarjun7/ai-qe-agent) · "
        "Powered by [Claude AI](https://anthropic.com) · "
        "[Playwright](https://playwright.dev) · "
        "[Gradio](https://gradio.app)"
    )

if __name__ == "__main__":
    demo.launch()
