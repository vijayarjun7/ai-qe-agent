# 🤖 AI QE Agent

> **Intelligent E2E Test Generation, Self-Healing & Reporting — Powered by Playwright + Claude AI**

AI QE Agent is a TypeScript-based automation framework that uses Claude AI to **automatically generate**, **run**, **self-heal**, and **report** end-to-end tests for Web, REST API, Mobile, and Desktop applications.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🌐 **URL-based Generation** | Point the agent at any URL — it analyzes the page and writes tests |
| 📝 **Requirements-based Generation** | Paste your user stories — Claude writes the test suite |
| 🔧 **Self-Healing** | Broken selectors are detected and auto-fixed using live DOM analysis |
| 🌐 **REST API Testing** | Generate API tests from endpoint definitions or OpenAPI specs |
| 📊 **AI Reports** | HTML reports with Claude-powered failure analysis |
| 📱 **Multi-Platform** | Web, Mobile, Desktop, and API test projects built-in |

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install
```

### 2. Configure environment

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY
```

### 3. Generate tests from a URL

```bash
npm run start -- generate --url https://yourapp.com --name my-app-tests
```

### 4. Run tests

```bash
npm test
npx playwright test --project=chromium
npx playwright test --project=api
npx playwright test --project=mobile-chrome
```

### 5. Self-heal broken tests

```bash
npm run start -- heal --url https://yourapp.com
```

### 6. Generate AI-powered report

```bash
npm run start -- report
```

---

## 🛠 CLI Reference

```bash
ai-qe generate --url <url> [--requirements <text>] [--name <name>]
ai-qe generate-api --spec ./openapi.json
ai-qe heal --url <url> [--watch]
ai-qe report
ai-qe interactive
```

---

## ⚙️ Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | *required* |
| `CLAUDE_MODEL` | Claude model to use | `claude-sonnet-4-6` |
| `BASE_URL` | Application base URL | `http://localhost:3000` |
| `API_BASE_URL` | API base URL | `http://localhost:3000` |
| `SELF_HEALING_ENABLED` | Enable self-healing | `true` |

---

## 🤝 Contributing

PRs welcome! This project is designed to grow with the testing community.

---

*Powered by [Playwright](https://playwright.dev) + [Claude AI](https://anthropic.com)*
