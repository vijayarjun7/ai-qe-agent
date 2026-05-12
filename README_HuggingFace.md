---
title: AI QE Agent
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
license: mit
short_description: Generate Playwright TypeScript tests & self-heal broken locators with Claude AI
---

# 🤖 AI QE Agent — Playwright Test Generator

Auto-generate production-ready **Playwright TypeScript** E2E tests from a URL or plain-English user story, powered by **Claude AI**.

## Features

- **Test Generator** — paste a URL or describe a feature in plain English; the agent generates a full Playwright TypeScript test suite using the Page Object Model pattern and semantic locators (`getByRole`, `getByLabel`, `getByTestId`).
- **Self-Healing Demo** — see how the agent detects brittle CSS/XPath selectors and upgrades them to resilient semantic Playwright locators. Includes an interactive "heal your own test" tool.

## Usage

1. Enter your **Anthropic API key** (get one free at [console.anthropic.com](https://console.anthropic.com)).
2. Choose the **Test Generator** tab, enter a URL or user story, pick a test type, and click **Generate Tests**.
3. Copy the output into your Playwright project and run with `npx playwright test`.

## About the Project

This demo is built on top of the full [ai-qe-agent](https://github.com/vijayarjun7/ai-qe-agent) TypeScript framework, which provides:

- AI-driven manual test generation from requirements
- QA peer-review agent
- Playwright automation script generation (UI, API, Mobile)
- Self-healing agent that validates live DOM and fixes broken selectors
- Change-detection that flags requirement-driven test updates for human review

## Tech Stack

- [Anthropic Claude API](https://anthropic.com) — test generation & self-healing intelligence  
- [Playwright](https://playwright.dev) — test output format  
- [Gradio](https://gradio.app) — demo UI  
- [TypeScript](https://www.typescriptlang.org) — underlying agent framework
