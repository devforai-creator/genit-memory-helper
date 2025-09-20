import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');

const TARGET_URL = process.env.GENIT_TEST_URL;

test.describe('GMH authenticated smoke', () => {
  test(
    TARGET_URL && process.env.GENIT_USER && process.env.GENIT_PASS
      ? 'loads panel on session page'
      : 'skipped (GENIT_TEST_URL/credentials missing)',
    async ({ page }) => {
      if (!TARGET_URL || !process.env.GENIT_USER || !process.env.GENIT_PASS) {
        test.skip(true);
      }

      const userScript = await readFile(distPath, 'utf8');
      await page.addInitScript(userScript);

      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

      const panel = page.locator('#genit-memory-helper-panel');
      await expect(panel).toBeVisible({ timeout: 15_000 });

      const loadButton = panel.locator('#gmh-autoload-all');
      await expect(loadButton).toBeVisible();
      await loadButton.click();

      const status = panel.locator('#gmh-status');
      await expect(status).toContainText('스크롤 완료', { timeout: 30_000 });
    }
  );
});
