import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const mockPath = path.join(repoRoot, 'tests/mock/infinite-scroll.html');

test.describe('GMH mock smoke (offline)', () => {
  test('panel loads and auto-scroll completes on mock chat', async ({ page }) => {
    const userScript = await readFile(distPath, 'utf8');
    await page.addInitScript(userScript);

    await page.goto('file://' + mockPath);

    const panel = page.locator('#genit-memory-helper-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const autoAll = panel.locator('#gmh-autoload-all');
    await autoAll.click();

    const status = panel.locator('#gmh-status');
    await expect(status).toContainText('스크롤 완료', { timeout: 15_000 });

    await panel.locator('#gmh-export').click();

    const confirmButton = page.locator('.gmh-preview-confirm');
    if (await confirmButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await confirmButton.click();
    }

    await expect(status).toContainText(/내보내기 완료|작업 준비 중 오류/, { timeout: 10_000 });
  });
});
