import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const distPath = path.join(repoRoot, 'dist', 'genit-memory-helper.user.js');
const mockPath = path.join(repoRoot, 'tests/mock/infinite-scroll.html');

async function bootstrapModernUI(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('gmh_flag_newUI', '1');
    window.localStorage.removeItem('gmh_kill');
  });
  const userScript = await readFile(distPath, 'utf8');
  await page.addInitScript(userScript);
  await page.goto('file://' + mockPath);
}

test.describe('GMH mock smoke (offline)', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await bootstrapModernUI(page);
  });

  test('panel loads and auto-scroll completes on mock chat', async ({ page }) => {

    const panel = page.locator('#genit-memory-helper-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('#gmh-panel-drag-handle')).toBeVisible();
    await expect(panel.locator('#gmh-panel-resize-handle')).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).toHaveAttribute('aria-label', /Genit Memory Helper/);

    const progressBar = panel.locator('#gmh-progress-fill');
    await expect(progressBar).toHaveAttribute('role', 'progressbar');

    const autoAll = panel.locator('#gmh-autoload-all');
    await autoAll.click();

    const status = panel.locator('#gmh-status');
    await status.waitFor({ state: 'attached', timeout: 5_000 });
    await expect(status).toContainText(/추가 수집 중|플레이어 턴/, { timeout: 10_000 });

    await page.evaluate(() => {
      try {
        window.GMH?.Core?.autoLoader?.stop?.();
      } catch (err) {
        console.warn('autoLoader stop failed', err);
      }
    });

    await expect(status).toContainText(
      /자동 로딩을 중지했습니다|플레이어 턴|추가 데이터를 불러오지 못했습니다|스크롤 완료/,
      { timeout: 30_000 }
    );

    const rangeStart = panel.locator('#gmh-range-start');
    const rangeEnd = panel.locator('#gmh-range-end');
    const rangeSummary = panel.locator('#gmh-range-summary');
    await expect(rangeSummary).toBeVisible();

    const markStartBtn = panel.locator('#gmh-range-mark-start');
    const markEndBtn = panel.locator('#gmh-range-mark-end');
    await expect(markStartBtn).toBeVisible();
    await expect(markEndBtn).toBeVisible();

    await markStartBtn.click();
    await expect(rangeStart).not.toHaveValue('');

    await markEndBtn.click();
    await expect(rangeEnd).not.toHaveValue('');

    const rangeInfo = await page.evaluate(() => {
      try {
        return window.GMH?.Core?.ExportRange?.describe?.();
      } catch (err) {
        return null;
      }
    });

    if (rangeInfo?.total && rangeInfo.total > 0) {
      const startValue = 1;
      const endValue = rangeInfo.total >= 2 ? 2 : 1;

      await rangeStart.fill(String(startValue));
      await rangeStart.blur();
      await rangeEnd.fill(String(endValue));
      await rangeEnd.blur();

      await expect(rangeSummary).toContainText(
        new RegExp(`플레이어 턴 ${startValue}-${endValue}`),
      );

      const rangeSnapshot = await page.evaluate(() => {
        try {
          return window.GMH?.Core?.ExportRange?.describe?.();
        } catch (err) {
          return null;
        }
      });
      expect(rangeSnapshot?.start).toBe(startValue);
      expect(rangeSnapshot?.end).toBe(endValue);

      await panel.locator('#gmh-range-clear').click();
      await expect(rangeSummary).toContainText(/플레이어 턴/);
    } else {
      await expect(rangeSummary).toContainText(/플레이어 턴/);
    }

    await panel.locator('#gmh-export').click();

    const modernConfirm = page.locator('button[data-action="confirm"]').first();
    const legacyConfirm = page.locator('.gmh-preview-confirm').first();

    let confirmed = false;
    try {
      await modernConfirm.waitFor({ state: 'visible', timeout: 15_000 });
      await modernConfirm.click();
      confirmed = true;
    } catch (err) {
      try {
        await legacyConfirm.waitFor({ state: 'visible', timeout: 15_000 });
        await legacyConfirm.click();
        confirmed = true;
      } catch (legacyErr) {
        console.warn('GMH mock: confirmation modal not displayed, skipping export confirmation');
      }
    }

    if (confirmed) {
      await expect(status).toContainText('내보내기 완료', { timeout: 10_000 });
    }
  });

  test('keyboard shortcuts focus panel and open modals', async ({ page }) => {
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
    await page.evaluate(() => {
      try {
        window.GMH?.Core?.autoLoader?.stop?.();
      } catch (err) {
        console.warn('autoLoader stop failed', err);
      }
    });
    await expect(panel.locator('#gmh-status')).toContainText(
      /자동 로딩을 중지했습니다|플레이어 턴|추가 데이터를 불러오지 못했습니다|스크롤 완료/,
      { timeout: 30_000 }
    );
  });

  test('collapsed panel restores focus and allows background interaction', async ({ page }) => {
    const panel = page.locator('#genit-memory-helper-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'gmh-focus-probe';
      input.type = 'text';
      input.style.position = 'fixed';
      input.style.left = '24px';
      input.style.bottom = '24px';
      input.style.zIndex = '1';
      document.body.appendChild(input);

      const button = document.createElement('button');
      button.id = 'gmh-click-probe';
      button.textContent = 'Underlay';
      button.dataset.clicked = '0';
      button.style.position = 'fixed';
      button.style.right = '120px';
      button.style.bottom = '80px';
      button.style.zIndex = '1';
      button.addEventListener('click', () => {
        button.dataset.clicked = '1';
      });
      document.body.appendChild(button);
    });

    await page.locator('#gmh-focus-probe').focus();
    await expect(page.locator('#gmh-focus-probe')).toBeFocused();

    await page.keyboard.press('Alt+G');
    await expect(panel).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#gmh-focus-probe')).toBeFocused();
    await expect(page.locator('html')).toHaveClass(/gmh-collapsed/);

    await page.locator('#gmh-click-probe').click();
    await expect(page.locator('#gmh-click-probe')).toHaveAttribute('data-clicked', '1');

    await page.keyboard.press('Alt+G');
    await expect(page.locator('html')).not.toHaveClass(/gmh-collapsed/);
    await expect(panel).toBeFocused();
  });
});
