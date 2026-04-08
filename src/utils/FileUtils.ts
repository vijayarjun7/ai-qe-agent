import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from './Logger';

/**
 * Save generated test code to a .spec.ts file.
 */
export async function saveTestFile(
  content: string,
  filename: string,
  outputDir: string = 'tests/generated'
): Promise<string> {
  await fs.ensureDir(outputDir);
  const filePath = path.join(outputDir, filename.endsWith('.spec.ts') ? filename : `${filename}.spec.ts`);
  await fs.writeFile(filePath, content, 'utf-8');
  logger.info(`✅ Test saved → ${filePath}`);
  return filePath;
}

/**
 * Read all generated test files.
 */
export async function listGeneratedTests(dir: string = 'tests/generated'): Promise<string[]> {
  await fs.ensureDir(dir);
  const files = await fs.readdir(dir);
  return files.filter((f) => f.endsWith('.spec.ts')).map((f) => path.join(dir, f));
}

/**
 * Read test file content.
 */
export async function readTestFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Write test file content (overwrite).
 */
export async function writeTestFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, 'utf-8');
  logger.info(`✅ Test updated → ${filePath}`);
}

/**
 * Slugify a string for use as a filename.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Ensure reports directory exists.
 */
export async function ensureReportsDir(dir: string = 'reports'): Promise<void> {
  await fs.ensureDir(dir);
}
