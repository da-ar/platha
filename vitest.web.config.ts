import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/web/**/*.test.{ts,tsx}'],
    setupFiles: ['test/web/setup.ts'],
    restoreMocks: true,
  },
})
