# AI QE Agent

> **End-to-End AI-Driven Quality Engineering Pipeline — Powered by Playwright + Claude AI**

AI QE Agent is a TypeScript automation framework that demonstrates a complete AI-driven QE pipeline:
**AI writes the app → AI writes & reviews manual tests → AI generates & reviews automation scripts → Self-healing on selector/requirement changes.**

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI QE AGENT PIPELINE                                │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│  PART 1      │  PART 2      │  PART 2      │  PART 2      │  PART 3         │
│  AI Dev      │  Manual Test │  QA Review   │  Automation  │  Self-Healing   │
│  Agent       │  Generator   │  Agent       │  Generator   │  & Change Watch │
│              │              │              │              │                 │
│  Generates   │  Reads       │  Peer-reviews│  Generates   │  Watches        │
│  full-stack  │  requirements│  test cases  │  UI/API/     │  demo-app/ for  │
│  app with    │  → writes 8  │  → scores    │  Mobile      │  locator or req │
│  React UI +  │  sample      │  coverage &  │  Playwright  │  changes →      │
│  Express API │  manual TCs  │  quality     │  scripts     │  auto-heal or   │
│  + SQLite    │              │              │              │  flag for review │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘
```

---

## Features

| Feature | Description |
|---|---|
| **AI Dev Agent** | Generates a complete React + Express + SQLite Task Manager app (20 files) |
| **Manual Test Generator** | Reads REQUIREMENTS.md, generates 8 structured sample manual TCs (token-efficient) |
| **QA Review Agent** | Peer-reviews manual test suites — scores coverage, flags weak tests, suggests additions |
| **Automation Script Generator** | Generates UI, API, Mobile Playwright scripts from approved manual TCs |
| **Automation Reviewer** | Code-reviews generated scripts for selector robustness, assertions, flakiness |
| **AI Mobile Tester** | Dedicated mobile testing across 7 device profiles and 10 scenario types |
| **Self-Healing Agent** | Detects broken selectors → auto-heals using live DOM analysis via Claude |
| **Change Detector** | Watches `demo-app/` with chokidar — classifies changes as locator/requirement/logic |
| **Review Queue** | Creates tickets in `tests/review-queue/` for requirement changes needing manual sign-off |
| **HTML Reports** | Playwright HTML + JSON + JUnit reports with screenshots and videos on failure |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Install Playwright browsers

```bash
npx playwright install chromium
# or install all browsers:
npx playwright install
```

> **Note:** If `npx` is not in your PATH, use the local binary:
> ```bash
> node_modules/.bin/playwright install chromium
> ```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:3001
```

---

## Usage — Full Pipeline Demo

### Run the complete demo (all parts)

```bash
npm run demo
# or step by step:
npm run demo:part1   # Generate the demo app
npm run demo:part2   # Run QE workflow (manual tests → review → automation → review)
npm run demo:part3   # Demonstrate self-healing
npm run demo:part4   # Demonstrate requirement change detection
```

---

## Part 1 — AI Dev Agent: Generate the Demo App

The AI Dev Agent generates a complete full-stack Task Manager app:

```bash
npm run dev-gen
```

This creates `demo-app/` with:
- `backend/` — Express + SQLite + JWT auth API (runs on port 3001)
- `frontend/` — React + Vite + React Router SPA (runs on port 3000)
- `REQUIREMENTS.md` — Functional requirements (used by QE agent)
- `README.md` + `setup.sh` — Setup instructions

**Start the app:**
```bash
cd demo-app && bash setup.sh
# Terminal 1: cd demo-app/backend && npm run dev
# Terminal 2: cd demo-app/frontend && npm run dev
# Open: http://localhost:3000
```

**Demo App Credentials:** `test@example.com` / `Test123!`

**API Endpoints:**
```
POST /api/auth/register    POST /api/auth/login    POST /api/auth/logout
GET  /api/tasks            POST /api/tasks
GET  /api/tasks/:id        PUT /api/tasks/:id      DELETE /api/tasks/:id
PATCH /api/tasks/:id/complete
```

---

## Part 2 — QE Workflow

### Step 1: Generate Manual Test Cases

```bash
npm run manual-tests
# or for a specific component:
npm run start -- manual-tests --requirements demo-app/REQUIREMENTS.md --component Login
```

**Output:** `tests/manual/<component>-manual-tests-<timestamp>.json` and `.md`

> **Token Efficiency Note:** The generator is designed to produce a _sample_ of 8 representative test cases (3 functional, 2 negative, 1 edge-case, 1 api, 1 mobile) rather than exhaustive coverage. Requirements are truncated to 3,000 characters. This keeps Claude API calls fast and cost-efficient. For full coverage, run once per component using `--component`.

**Sample output structure:**
```json
{
  "suiteId": "SUITE-1775765749606",
  "suiteName": "Full Application Test Suite",
  "testCases": [
    {
      "id": "TC-001",
      "title": "Successful login with valid credentials",
      "type": "functional",
      "priority": "P0",
      "steps": [{ "stepNumber": 1, "action": "Navigate to /login", "expectedOutcome": "Login form displayed" }],
      "status": "draft"
    }
  ]
}
```

### Step 2: QA Peer Review of Manual Tests

```bash
npm run qa-review
```

**Output:** `tests/reviews/review-manual-<component>-<timestamp>.json` and `.md`

The QA Review Agent evaluates:
- **Coverage Score** (0–100): breadth of test types covered
- **Quality Score** (0–100): clarity, completeness, pass/fail criteria
- **Verdict:** `approved` | `approved-with-comments` | `needs-revision`
- **Coverage Gaps:** missing scenarios identified
- **Suggested Additions:** recommended new test cases
- **Approved/Flagged Test IDs:** used in the next step

**Sample review output:**
```
Verdict: ⚠️ APPROVED-WITH-COMMENTS
Coverage Score: 72/100
Quality Score: 85/100

Coverage Gaps:
- No test for session expiry / token refresh
- Missing concurrent login scenario

Flagged: TC-003, TC-007
Approved: TC-001, TC-002, TC-004, TC-005, TC-006, TC-008
```

### Step 3: Generate Automation Scripts

```bash
npm run gen-automation
```

This generates from **approved test cases only**:

| Script | Location | Tests |
|---|---|---|
| UI (Playwright E2E) | `tests/generated/<component>-ui.spec.ts` | 10–15 |
| API (APIRequestContext) | `tests/generated/<component>-api.spec.ts` | 30–50 |
| Mobile (7 devices × scenarios) | `tests/generated/<component>-mobile.spec.ts` | 50–60 |

**Automation uses:**
- `getByRole`, `getByLabel`, `getByTestId` (no CSS selectors)
- Page Object Model for pages with 4+ interactions
- `test.describe()` grouping and descriptive names
- Auth token reuse across API tests via `beforeAll`

### Step 4: Run Automation + Generate Reports

```bash
# With the demo app running at localhost:3000:
npm test

# Run specific project:
npm test -- --project=chromium     # Desktop Chrome
npm test -- --project=mobile-chrome  # Pixel 5
npm test -- --project=api          # API tests only

# Generate AI-powered HTML report:
npm run report
```

**Reports generated in `reports/`:**
- `reports/html/index.html` — Interactive Playwright HTML report (screenshots + videos on failure)
- `reports/results.json` — Machine-readable JSON results
- `reports/results.xml` — JUnit XML (for CI integration)

---

## Part 3 — Self-Healing & Change Detection

### Watch for changes

```bash
npm run watch:changes
# Watches demo-app/ for any file changes
```

When a change is detected, the agent:
1. **Classifies the change:** `requirement | locator | logic | style | unknown`
2. **For locator changes:** Runs `SelfHealingAgent` to auto-fix broken selectors
3. **For requirement changes:** Creates a review ticket in `tests/review-queue/`

### Demonstrate self-healing (offline — no server needed)

```bash
npm run demo:self-heal
# or
npm run demo:part3
```

**How it works:**

1. **Breaks 3 selectors** in `tests/generated/all-ui.spec.ts` — simulating a developer renaming `data-testid` attributes during a UI refactor
2. **Claude receives** the broken file + a static DOM snapshot of the known app
3. **Claude identifies** the correct selectors from the DOM and patches the file
4. **Reports each fix** with before/after/reason — and writes the healed file back

**Actual demo output:**

```
⚠️  Introduced 3 broken selector(s) to simulate a UI refactor:

  1. Login button testid renamed during UI refactor
     BROKEN: getByTestId('btn-login-v2')
  2. Email input testid changed to match design system naming
     BROKEN: getByTestId('user-email-field')
  3. Task list wrapper testid updated in new component structure
     BROKEN: getByTestId('tasks-container-main')

🤖 Sending broken test file to Claude for self-healing...

✅ Self-healing SUCCESSFUL — 3 selector(s) repaired:

  Change 1: Login button testid renamed during UI refactor
    BEFORE: getByTestId('btn-login-v2')
    AFTER:  getByTestId('login-btn')

  Change 2: Email input testid changed to match design system naming
    BEFORE: getByTestId('user-email-field')
    AFTER:  getByTestId('email-input')

  Change 3: Task list wrapper testid updated in new component structure
    BEFORE: getByTestId('tasks-container-main')
    AFTER:  getByTestId('task-list')

📄 Healed file written: tests/generated/all-ui.spec.ts
```

> **No running server required.** The healer uses a static DOM reference that mirrors the AI-generated app's actual HTML — making this fully repeatable in any environment.

### Demonstrate requirement change detection

```bash
npm run demo:part4
```

This appends a new requirement to REQUIREMENTS.md, detects it, and creates a review ticket:

```
tests/review-queue/
├── QUEUE.json                    ← Index of all pending tickets
├── req-change-<id>.json          ← Machine-readable ticket
└── req-change-<id>.md            ← Human-readable review ticket
```

**Sample ticket:**
```markdown
# Review Ticket: Requirement Change Detected
Severity: CRITICAL
Affected Tests: TC-001, TC-003, TC-006
Action Required: Review new requirement, approve test changes

New requirement detected:
> "Users should be able to export tasks as CSV"

Impacted test areas: Task CRUD, Dashboard
```

### View review queue

```bash
npm run review-queue
```

---

## Mobile Testing

### Run mobile tests standalone

```bash
npm run mobile-test
# Against a specific URL:
npm run mobile-test:url -- --url https://yourapp.com
# All 10 scenario types:
npm run mobile-test:all-scenarios
# List available devices and scenarios:
npm run mobile-test:list
```

**Supported Devices (7):**
- iPhone SE, iPhone 13, iPhone 13 Pro Max
- Pixel 5, Galaxy S21
- iPad Mini, iPad Pro 11

**Test Scenarios (10):**
- `layout` — viewport, responsive grid, no horizontal scroll
- `navigation` — hamburger menu, bottom nav, gestures
- `touch` — 44px tap targets, swipe interactions
- `orientation` — portrait/landscape switching
- `network` — slow 3G simulation, offline mode
- `performance` — LCP, CLS, FCP measurements
- `accessibility` — ARIA, contrast, screen reader targets
- `pwa` — service worker, manifest, installability
- `forms` — virtual keyboard handling, input types
- `media` — image loading, video player, srcset

---

## Sample Pipeline Outputs

The [`samples/`](samples/) directory contains real outputs from running the pipeline — generated by Claude, not hand-crafted:

| Sample | Description |
|---|---|
| [samples/manual-tests/sample-manual-test-suite.md](samples/manual-tests/sample-manual-test-suite.md) | 8 AI-generated manual test cases with steps, acceptance criteria, priorities |
| [samples/manual-tests/sample-manual-test-suite.json](samples/manual-tests/sample-manual-test-suite.json) | Structured JSON version of the same suite |
| [samples/qa-reviews/sample-qa-review-report.md](samples/qa-reviews/sample-qa-review-report.md) | QA peer review — verdict, scores, coverage gaps, flagged tests |
| [samples/qa-reviews/sample-qa-review-report.json](samples/qa-reviews/sample-qa-review-report.json) | Machine-readable review data |
| [samples/generated-tests/ui.spec.ts](samples/generated-tests/ui.spec.ts) | AI-generated Playwright UI tests with Page Object Model |
| [samples/generated-tests/api.spec.ts](samples/generated-tests/api.spec.ts) | AI-generated API tests (auth, CRUD, error cases) |
| [samples/generated-tests/mobile.spec.ts](samples/generated-tests/mobile.spec.ts) | AI-generated mobile tests (57 tests, 7 devices, 4 scenarios) |
| [samples/generated-tests/automation-bundle.json](samples/generated-tests/automation-bundle.json) | Bundle manifest linking all generated scripts back to manual TC IDs |

---

## Full QE Pipeline (One Command)

```bash
npm run pipeline
```

Runs all 6 steps in sequence:
1. Generate demo app (if not present)
2. Generate manual test cases from REQUIREMENTS.md
3. QA review — approve/flag test cases
4. Generate automation scripts (UI + API + Mobile)
5. Review automation scripts
6. Run tests against localhost + generate HTML report

---

## Standalone Commands

```bash
# Original URL-based test generation (legacy)
npm run start -- generate --url https://yourapp.com --name my-tests

# Self-heal a specific test file
npm run start -- heal --url http://localhost:3000 --file tests/generated/login.spec.ts

# Interactive wizard
npm run start -- interactive

# Generate AI report from existing results
npm run report
```

---

## Project Structure

```
ai-qe-agent/
├── src/
│   ├── agent/
│   │   ├── AIDevAgent.ts              # Generates full-stack demo app (20 files)
│   │   ├── ManualTestGenerator.ts     # Generates manual TCs from requirements
│   │   ├── QAReviewAgent.ts           # Peer-reviews manual TCs and automation scripts
│   │   ├── AutomationScriptGenerator.ts  # Generates UI + API + Mobile Playwright scripts
│   │   ├── AIMobileTester.ts          # Dedicated mobile tester (7 devices, 10 scenarios)
│   │   ├── ChangeDetector.ts          # chokidar watcher + change classifier
│   │   ├── ReviewQueueManager.ts      # Creates/manages review tickets
│   │   ├── SelfHealingAgent.ts        # Auto-heals broken selectors via DOM analysis
│   │   ├── AITestGenerator.ts         # URL-based test generation (original)
│   │   └── ReportGenerator.ts         # AI-powered HTML report generator
│   ├── orchestrator/
│   │   └── QEPipeline.ts              # Orchestrates the full 6-step pipeline
│   ├── core/
│   │   ├── PageAnalyzer.ts            # Extracts page structure via Playwright
│   │   └── APITester.ts               # REST API test generator
│   ├── utils/
│   │   ├── ClaudeClient.ts            # Anthropic Claude API wrapper
│   │   ├── Logger.ts                  # Structured logging (Winston)
│   │   └── FileUtils.ts               # File I/O helpers
│   └── cli/
│       └── index.ts                   # CLI entry point (Commander.js)
├── tests/
│   ├── examples/                      # Hand-crafted example tests
│   │   ├── login.spec.ts
│   │   ├── mobile-responsive.spec.ts
│   │   └── api-users.api.spec.ts
│   ├── generated/                     # AI-generated automation scripts
│   │   ├── all-ui.spec.ts
│   │   ├── all-api.spec.ts
│   │   └── taskmaster-mobile.spec.ts
│   ├── manual/                        # Manual test case artifacts
│   │   ├── *.json                     # Structured test suite data
│   │   └── *.md                       # Human-readable test cases
│   └── reviews/                       # QA review reports
│       ├── *.json
│       └── *.md
├── reports/
│   ├── html/index.html                # Playwright HTML report
│   ├── results.json                   # JSON test results
│   └── results.xml                    # JUnit XML
├── demo-app/                          # AI-generated Task Manager app
│   ├── backend/                       # Express + SQLite + JWT
│   ├── frontend/                      # React + Vite + TypeScript
│   ├── REQUIREMENTS.md                # App requirements (used by QE agent)
│   └── setup.sh                       # One-command setup
├── playwright.config.ts               # Multi-project config (6 projects)
├── tsconfig.json
├── package.json
└── .env.example
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | **required** |
| `CLAUDE_MODEL` | Claude model | `claude-sonnet-4-6` |
| `BASE_URL` | Frontend URL | `http://localhost:3000` |
| `API_BASE_URL` | API URL | `http://localhost:3001` |
| `GENERATED_TESTS_DIR` | Where to save generated tests | `tests/generated` |
| `MAX_TESTS_PER_PAGE` | Max tests per generation | `10` |
| `SELF_HEALING_ENABLED` | Enable self-healing | `true` |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLI (Commander.js)                             │
└──────┬──────────┬──────────┬──────────┬──────────┬───────────────────┘
       │          │          │          │          │
  ┌────▼───┐ ┌───▼────┐ ┌───▼───┐ ┌───▼────┐ ┌───▼──────────────┐
  │ AI Dev │ │Manual  │ │  QA   │ │ Auto-  │ │ Self-Healing &   │
  │ Agent  │ │ Test   │ │Review │ │mation  │ │ Change Detector  │
  │        │ │  Gen   │ │ Agent │ │  Gen   │ │                  │
  └────┬───┘ └───┬────┘ └───┬───┘ └───┬────┘ └───┬──────────────┘
       │         │           │          │           │
  ┌────▼─────────▼───────────▼──────────▼───────────▼──────────────┐
  │                  Claude AI (claude-sonnet-4-6)                   │
  │            Batched calls (4 parallel) — token-minimized          │
  └─────────────────────────────────────┬──────────────────────────┘
                                         │
  ┌──────────────────────────────────────▼──────────────────────────┐
  │                   Playwright Browser Engine                      │
  │        Chrome | Firefox | Safari | Mobile | API (no browser)    │
  └─────────────────────────────────────────────────────────────────┘
```

---

## Token Efficiency Design

This agent is designed to work within Claude API token budgets:

| Operation | Technique | Token Saving |
|---|---|---|
| Manual test generation | Request 8 sample TCs, not exhaustive | ~75% fewer tokens |
| Requirements ingestion | Truncate to 3,000 chars | ~80% fewer tokens |
| QA review | Pass compact TC summary (id/title/type/stepsCount) | ~60% fewer tokens |
| Automation generation | Slice to 6 TCs per prompt | ~40% fewer tokens |
| App generation | Batch 4 files per Claude call | Avoids rate limits |
| JSON recovery | Regex fallback extracts partial objects | Handles truncated responses |

---

## CI/CD Integration

```yaml
# .github/workflows/ai-qe.yml
- name: Install deps
  run: npm ci && npx playwright install chromium

- name: Run QE Pipeline
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    BASE_URL: http://localhost:3000
  run: npm run pipeline

- name: Upload Reports
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: reports/
```

---

## Powered By

- [Playwright](https://playwright.dev) — Browser automation
- [Claude AI (Anthropic)](https://anthropic.com) — AI-powered test generation and analysis
- [chokidar](https://github.com/paulmillr/chokidar) — File watching for change detection
- [TypeScript](https://www.typescriptlang.org) — Type-safe automation scripts
- [Winston](https://github.com/winstonjs/winston) — Structured logging
