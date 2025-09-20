import { chromium, FullConfig } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const STORAGE_DIR = path.resolve('.auth');
const STORAGE_PATH = path.join(STORAGE_DIR, 'state.json');

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export default async function globalSetup(_config: FullConfig) {
  const username = env('GENIT_USER');
  const password = env('GENIT_PASS');

  if (!username || !password) {
    console.log('[GMH] GENIT_USER/PASS not provided – skipping authenticated storage state generation.');
    return;
  }

  const loginUrl = env('GENIT_LOGIN_URL', 'https://genit.ai/login');
  const emailSelector = env('GENIT_LOGIN_EMAIL_SELECTOR', 'input[type="email"]');
  const passwordSelector = env('GENIT_LOGIN_PASSWORD_SELECTOR', 'input[type="password"]');
  const submitSelector = env('GENIT_LOGIN_SUBMIT_SELECTOR', 'button[type="submit"], button:has-text("로그인")');
  const successSelector = env('GENIT_LOGIN_SUCCESS_SELECTOR', '[data-testid="chat-container"], main, #__next');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector(emailSelector, { timeout: 15_000 });
    await page.fill(emailSelector, username);
    await page.fill(passwordSelector, password);
    await page.click(submitSelector);

    await page.waitForLoadState('networkidle');
    await page.waitForSelector(successSelector, { timeout: 20_000 });

    await mkdir(STORAGE_DIR, { recursive: true });
    await page.context().storageState({ path: STORAGE_PATH });
    console.log('[GMH] Playwright storage state saved to %s', STORAGE_PATH);
  } catch (error) {
    console.error('[GMH] Failed to generate storage state:', error);
    throw error;
  } finally {
    await browser.close();
  }
}
