import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

const DEMO_URL = process.env.GENIT_DEMO_URL;

test.describe('GMH public demo smoke', () => {
  test(DEMO_URL ? 'panel mounts on demo page' : 'skipped (GENIT_DEMO_URL not set)', async ({ page }) => {
    if (!DEMO_URL) {
      test.skip(true);
    }

    const userScript = await readFile(distPath, 'utf8');
    await page.addInitScript(userScript);

    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });

    const panel = page.locator('#genit-memory-helper-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
  });
});
