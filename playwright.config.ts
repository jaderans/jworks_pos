import { defineConfig } from '@playwright/test';

// Uses the Chrome already installed on this computer (no browser download).
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1366, height: 860 },
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
