import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { SETUP_SECRET: 'test-secret', GITHUB_ORG: 'acme', SLACK_TEAM_ID: 'T0000000' },
      },
    }),
  ],
  test: {
    include: ['test/worker/**/*.test.ts'],
  },
})
