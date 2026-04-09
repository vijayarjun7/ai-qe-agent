import { ClaudeClient } from '../utils/ClaudeClient';
import { saveTestFile, slugify } from '../utils/FileUtils';
import { logger } from '../utils/Logger';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface APIEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description?: string;
  requestBody?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  expectedStatus?: number;
  expectedResponseSchema?: Record<string, unknown>;
}

export interface APITestOptions {
  baseURL?: string;
  endpoints?: APIEndpoint[];
  openapiSpecPath?: string;
  openapiSpecURL?: string;
  outputDir?: string;
  testName?: string;
  authType?: 'none' | 'bearer' | 'basic' | 'apikey';
  authValue?: string;
}

const API_SYSTEM_PROMPT = `You are an expert QA engineer specializing in REST API testing with Playwright's APIRequestContext.
Generate comprehensive API test suites in TypeScript using Playwright's built-in API testing capabilities.

Rules:
- Use import { test, expect, request } from '@playwright/test'
- Use test.describe() to group endpoints
- Test happy paths AND error paths (400, 401, 404, 422, 500)
- Validate response status, headers, and body schema
- Add authentication setup in beforeAll when required
- Use environment variables for base URLs and auth tokens
- Include data-driven tests using test.each() for parametrized scenarios
- Output ONLY valid TypeScript code.`;

export class APITester {
  private claude: ClaudeClient;

  constructor() {
    this.claude = new ClaudeClient();
  }

  /**
   * Generate API tests from a list of endpoint definitions.
   */
  async generateFromEndpoints(options: APITestOptions): Promise<string> {
    logger.info(`🌐 Generating API tests for ${options.endpoints?.length || 0} endpoint(s)...`);

    const prompt = this.buildEndpointPrompt(options);
    const code = await this.claude.complete(prompt, { system: API_SYSTEM_PROMPT });
    const cleanCode = this.cleanCode(code);

    const name = options.testName || `api-${Date.now()}`;
    const outputDir = options.outputDir || 'tests/generated';
    const filePath = await saveTestFile(cleanCode, `${name}.api.spec.ts`, outputDir);

    logger.info(`✅ API tests saved → ${filePath}`);
    return filePath;
  }

  /**
   * Generate API tests from an OpenAPI / Swagger spec file.
   */
  async generateFromOpenAPISpec(options: APITestOptions): Promise<string> {
    let specContent: string;

    if (options.openapiSpecPath) {
      logger.info(`📄 Reading OpenAPI spec from: ${options.openapiSpecPath}`);
      specContent = await fs.readFile(options.openapiSpecPath, 'utf-8');
    } else if (options.openapiSpecURL) {
      logger.info(`🌐 Fetching OpenAPI spec from: ${options.openapiSpecURL}`);
      const axios = await import('axios');
      const response = await axios.default.get(options.openapiSpecURL, { timeout: 15000 });
      specContent = JSON.stringify(response.data);
    } else {
      throw new Error('Either openapiSpecPath or openapiSpecURL must be provided');
    }

    // Truncate if too large
    const truncatedSpec = specContent.substring(0, 20000);

    const prompt = `
Generate a comprehensive Playwright TypeScript API test suite from this OpenAPI specification:

BASE URL: ${options.baseURL || process.env.API_BASE_URL || 'http://localhost:3000'}

OPENAPI SPEC (may be truncated):
${truncatedSpec}

Cover all endpoints with:
- Success scenarios (2xx)
- Client error scenarios (4xx)
- Schema validation
- Authentication where required (${options.authType || 'none'})

Output ONLY the TypeScript test file.
`.trim();

    const code = await this.claude.complete(prompt, { system: API_SYSTEM_PROMPT, maxTokens: 8192 });
    const cleanCode = this.cleanCode(code);

    const name = options.testName || `api-openapi-${Date.now()}`;
    const outputDir = options.outputDir || 'tests/generated';
    const filePath = await saveTestFile(cleanCode, `${name}.api.spec.ts`, outputDir);

    logger.info(`✅ API tests from OpenAPI spec saved → ${filePath}`);
    return filePath;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private buildEndpointPrompt(options: APITestOptions): string {
    const { endpoints = [], baseURL, authType = 'none', authValue } = options;

    return `
Generate Playwright TypeScript API tests for these REST API endpoints.

BASE URL: ${baseURL || process.env.API_BASE_URL || 'http://localhost:3000'}

ENDPOINTS:
${JSON.stringify(endpoints, null, 2)}

AUTHENTICATION: ${authType}${authValue ? ` (token: ${authValue.substring(0, 10)}***)` : ''}

For each endpoint generate:
1. Happy path test (valid request → expected success status)
2. Validation test (invalid/missing fields → 400 or 422)
3. Auth test (missing/invalid auth → 401) if auth is required
4. Not found test (non-existent resource → 404) for GET/PUT/DELETE endpoints

Output ONLY valid TypeScript.
`.trim();
  }

  private cleanCode(raw: string): string {
    return raw
      .replace(/^```(?:typescript|ts)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
  }
}
