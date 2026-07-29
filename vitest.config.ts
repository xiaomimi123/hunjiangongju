import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  resolve: {
    // web/tsconfig.json 里 "@/*" -> "./*"（相对 web/），vitest 不读 tsconfig paths，这里手动对齐
    alias: { '@': path.resolve(__dirname, 'web') },
  },
  test: {
    include: ['packages/**/*.test.ts', 'web/**/*.test.ts', 'worker/**/*.test.ts'],
    passWithNoTests: true,
  },
})
