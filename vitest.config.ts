import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'web/**/*.test.ts', 'worker/**/*.test.ts'],
    passWithNoTests: true,
  },
})
