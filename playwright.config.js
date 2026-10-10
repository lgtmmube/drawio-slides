import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'workspace.spec.js',
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.APP_URL || 'http://127.0.0.1:48765',
    viewport: { width: 1500, height: 950 },
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.APP_URL ? undefined : { command: 'npm run dev', url: 'http://127.0.0.1:48765', reuseExistingServer: true, timeout: 120000 },
});
