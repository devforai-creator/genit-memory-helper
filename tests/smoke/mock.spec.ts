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
    await page.addInitScript(() => {
      window.localStorage.setItem('gmh_flag_newUI', '1');
      window.localStorage.removeItem('gmh_kill');
    });
    const userScript = await readFile(distPath, 'utf8');
    await page.addInitScript(userScript);

    await page.goto('file://' + mockPath);

    const panel = page.locator('#genit-memory-helper-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).toHaveAttribute('aria-label', /Genit Memory Helper/);

    const progressBar = panel.locator('#gmh-progress-fill');
    await expect(progressBar).toHaveAttribute('role', 'progressbar');

    const autoAll = panel.locator('#gmh-autoload-all');
    await autoAll.click();

    const status = panel.locator('#gmh-status');
    await expect(status).toContainText(/플레이어 턴|추가 데이터를 불러오지 못했습니다|스크롤 완료/, {
      timeout: 60_000,
    });

    await panel.locator('#gmh-export').click();

    const confirmButton = page.locator('button[data-action="confirm"]');
    await confirmButton.click({ timeout: 5_000 });

    await expect(status).toContainText('내보내기 완료', { timeout: 10_000 });
  });

  test('keyboard shortcuts focus panel and open modals', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('gmh_flag_newUI', '1');
      window.localStorage.removeItem('gmh_kill');
    });
    const userScript = await readFile(distPath, 'utf8');
    await page.addInitScript(userScript);

    await page.goto('file://' + mockPath);

    const panel = page.locator('#genit-memory-helper-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Alt+G');
    await expect(panel).toBeFocused();

    await page.keyboard.press('Alt+P');
    const modal = page.locator('.gmh-modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await page.locator('button[data-action="cancel"]').click();

    await page.keyboard.press('Alt+S');
    const progressLabel = panel.locator('#gmh-progress-label');
    await expect(progressLabel).toContainText(/위로 끝까지 로딩|턴 확보/, { timeout: 5_000 });
    await expect(panel.locator('#gmh-status')).toContainText(
      /플레이어 턴|추가 데이터를 불러오지 못했습니다|스크롤 완료/,
      { timeout: 60_000 }
    );
  });
});
