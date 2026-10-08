import { defineConfig, devices } from '@playwright/test'

const vars = ['GITHUB_API_BASE:http://localhost:8790', 'SETUP_SECRET:e2e-secret', 'GITHUB_ORG:acme', 'SLACK_TEAM_ID:T0000000']

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:8787',
    ...devices['Desktop Chrome'],
    // Set this to use a browser other than Playwright's bundled one.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'node --experimental-strip-types e2e/fake-github.ts',
      url: 'http://localhost:8790/health',
      reuseExistingServer: false,
    },
    {
      // Fresh local state each run, so /setup is always available.
      command: `rm -rf .wrangler/e2e && npm run build && npx wrangler dev --port 8787 --persist-to .wrangler/e2e ${vars.map((v) => `--var ${v}`).join(' ')}`,
      url: 'http://localhost:8787/api/setup',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
