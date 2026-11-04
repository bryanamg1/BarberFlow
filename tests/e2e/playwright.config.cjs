const { defineConfig } = require('@playwright/test');
const { guard, manifest, privateRoot } = require('./helpers/environment.cjs');
const path = require('node:path');

guard();
// Pinned Playwright 1.64.1 otherwise captures an unmasked accessibility snapshot on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

module.exports = defineConfig({
  testDir: './web',
  testMatch: '**/*.spec.cjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  forbidOnly: true,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [[require.resolve('./helpers/evidence.cjs')]],
  outputDir: path.join(privateRoot, 'playwright-output'),
  use: {
    baseURL: manifest.baseUrl,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    serviceWorkers: 'block',
  },
});
