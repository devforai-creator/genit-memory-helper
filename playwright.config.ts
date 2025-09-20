import { defineConfig } from '@playwright/test';

const hasCredentials = Boolean(process.env.GENIT_USER && process.env.GENIT_PASS);

export default defineConfig({
  globalSetup: hasCredentials ? './playwright.global-setup.ts' : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  testMatch: ['tests/smoke/**/*.spec.ts', 'tests/smoke/**/*.spec.js'],
  timeout: 20_000,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114 Safari/537.36',
    storageState: hasCredentials ? '.auth/state.json' : undefined,
  },
});
