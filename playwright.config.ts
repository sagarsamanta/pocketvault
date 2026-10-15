import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8099);

/**
 * End-to-end tests for the web build (Expo web + expo-sqlite wasm).
 * Native-only features (share intents, OCR, file import, notifications) are
 * verified on an Android device/emulator instead.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome',
    viewport: { width: 412, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'], channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' } }],
  webServer: {
    command: `npx expo start --web --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { CI: '1', BROWSER: 'none' },
  },
});
