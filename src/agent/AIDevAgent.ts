import * as path from 'path';
import * as fs from 'fs-extra';
import { ClaudeClient } from '../utils/ClaudeClient';
import { logger } from '../utils/Logger';

export interface AppSpec {
  appName: string;
  description: string;
  features: string[];
  outputDir?: string;
}

export interface GeneratedApp {
  outputDir: string;
  files: GeneratedFile[];
  setupInstructions: string;
  requirementsFile: string;
}

export interface GeneratedFile {
  path: string;       // relative to outputDir
  content: string;
  purpose: string;
}

const AI_DEV_SYSTEM = `You are an expert full-stack developer. You write clean, working, production-quality code.
When asked to generate files, output ONLY the raw file content — no markdown fences, no explanations.
Use modern TypeScript/React patterns. Every file must be complete and runnable.`;

export class AIDevAgent {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Generate a complete full-stack Task Manager demo app.
   * Writes files to demo-app/ with UI (React), API (Express+SQLite), mobile-responsive layout.
   */
  async generateApp(spec: AppSpec): Promise<GeneratedApp> {
    const outputDir = spec.outputDir || path.join(process.cwd(), 'demo-app');
    logger.info(`🏗️  AI Dev Agent generating: ${spec.appName} → ${outputDir}`);

    const files: GeneratedFile[] = [];

    // Generate files in batches of 4 to avoid API rate limits
    const fileDefs: Array<[string, string]> = [
      ['backend/package.json',           'Express + SQLite backend package.json'],
      ['backend/tsconfig.json',           'TypeScript config for backend'],
      ['backend/.env.example',            'Environment variables template'],
      ['backend/src/db/schema.sql',       'SQLite schema for users and tasks'],
      ['backend/src/db/init.ts',          'Database initialiser using better-sqlite3'],
      ['backend/src/routes/auth.ts',      'Express auth routes: POST /api/auth/login, POST /api/auth/register, POST /api/auth/logout'],
      ['backend/src/routes/tasks.ts',     'Express CRUD task routes: GET/POST /api/tasks, GET/PUT/DELETE /api/tasks/:id'],
      ['backend/src/index.ts',            'Express server entry point wiring all routes, CORS, JSON body parser, JWT middleware'],
      ['frontend/src/App.tsx',            'Root React app with React Router: / redirects to /login, /dashboard shows tasks'],
      ['frontend/src/pages/Login.tsx',    'Login page with email+password form, validation, API call, stores JWT in localStorage'],
      ['frontend/src/pages/Dashboard.tsx','Dashboard page listing all tasks for logged-in user with add/edit/delete/complete actions'],
      ['frontend/src/components/TaskForm.tsx', 'Reusable task form component for create and edit, with title, description, priority, due date fields'],
      ['frontend/src/components/TaskCard.tsx', 'Task card component displaying task info with complete/edit/delete buttons'],
      ['frontend/src/services/api.ts',    'Axios-based API service with auth token injection and all CRUD methods'],
      ['frontend/src/styles/App.css',     'Mobile-first responsive CSS using CSS variables for theming, responsive grid for task list'],
      ['frontend/vite.config.ts',         'Vite config proxying /api to localhost:3001'],
      ['frontend/package.json',           'React + Vite + TypeScript frontend package.json'],
      ['frontend/index.html',             'Vite HTML entry point'],
      ['REQUIREMENTS.md',                 'Detailed functional requirements for each feature with acceptance criteria — used by QE agent to generate test cases'],
      ['README.md',                       'Setup and run instructions for the full-stack app'],
    ];

    const generatedContents = await this.generateInBatches(fileDefs, spec, 4);

    const allGenerated = fileDefs.map(([relativePath], i) => ({
      relativePath,
      content: generatedContents[i],
      purpose: fileDefs[i][1],
    }));

    // Write all files
    for (const f of allGenerated) {
      const fullPath = path.join(outputDir, f.relativePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, f.content, 'utf-8');
      files.push({ path: f.relativePath, content: f.content, purpose: f.purpose });
      logger.info(`  ✅ Wrote ${f.relativePath}`);
    }

    // Write a setup script
    const setupScript = this.buildSetupScript();
    const setupPath = path.join(outputDir, 'setup.sh');
    await fs.writeFile(setupPath, setupScript, 'utf-8');
    await fs.chmod(setupPath, 0o755);

    const requirementsFile = path.join(outputDir, 'REQUIREMENTS.md');
    logger.info(`🎉 App generated at ${outputDir} — ${files.length} files written`);

    return {
      outputDir,
      files,
      setupInstructions: `cd ${outputDir} && bash setup.sh`,
      requirementsFile,
    };
  }

  /**
   * Generate files in batches of `batchSize` to stay within API rate limits.
   */
  private async generateInBatches(
    fileDefs: Array<[string, string]>,
    spec: AppSpec,
    batchSize: number
  ): Promise<string[]> {
    const results: string[] = [];
    for (let i = 0; i < fileDefs.length; i += batchSize) {
      const batch = fileDefs.slice(i, i + batchSize);
      logger.info(`  📦 Generating batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(fileDefs.length / batchSize)}: ${batch.map(([p]) => p).join(', ')}`);
      const batchResults = await Promise.all(
        batch.map(([relativePath, description]) => this.generateFile(relativePath, spec, description))
      );
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * Generate a single file for the app using Claude.
   */
  private async generateFile(relativePath: string, spec: AppSpec, fileDescription: string): Promise<string> {
    const ext = path.extname(relativePath).replace('.', '');
    const prompt = `
Generate the file: ${relativePath}
App: ${spec.appName} — ${spec.description}
Features: ${spec.features.join(', ')}

File purpose: ${fileDescription}

RULES:
- Output ONLY the raw file content. No markdown fences. No explanations.
- The file must be complete and immediately runnable/usable.
- Use TypeScript where applicable (${ext === 'ts' || ext === 'tsx' ? 'yes' : 'no'}).
- For .env.example files, use placeholder values like YOUR_JWT_SECRET.
- For SQL, use INTEGER PRIMARY KEY AUTOINCREMENT, TEXT, and BOOLEAN (0/1) types.
- For backend: use express, better-sqlite3, bcryptjs, jsonwebtoken, cors.
- For frontend: use React 18, React Router v6, axios. No external UI libraries (pure CSS).
- Mobile responsive CSS: use flexbox/grid, breakpoints at 768px and 480px.
- All data-testid attributes must be present on key interactive elements for Playwright tests.
  Key data-testid values to use consistently:
  Login: data-testid="email-input", "password-input", "login-btn", "login-error"
  Dashboard: data-testid="task-list", "add-task-btn", "task-card", "task-title", "task-complete-btn", "task-edit-btn", "task-delete-btn", "logout-btn"
  TaskForm: data-testid="task-form", "title-input", "description-input", "priority-select", "due-date-input", "save-task-btn", "cancel-btn"
`.trim();

    const content = await this.claude.complete(prompt, {
      system: AI_DEV_SYSTEM,
      maxTokens: 4096,
    });

    // Strip any accidental markdown fences
    return content
      .replace(/^```[\w]*\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
  }

  private buildSetupScript(): string {
    return `#!/bin/bash
set -e

echo "🚀 Setting up Task Manager Demo App..."

# Backend
echo "\\n📦 Installing backend dependencies..."
cd backend
npm install
cp -n .env.example .env 2>/dev/null || true
cd ..

# Frontend
echo "\\n📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

echo "\\n✅ Setup complete!"
echo ""
echo "To start the app:"
echo "  Terminal 1 (API):      cd backend && npm run dev"
echo "  Terminal 2 (Frontend): cd frontend && npm run dev"
echo ""
echo "Then open: http://localhost:3000"
echo "API runs on: http://localhost:3001"
`;
  }
}
