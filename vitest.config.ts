import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    typecheck: { enabled: true, include: ['test/**/*.test-d.ts'] },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/types.ts'],
      reporter: ['text'],
      thresholds: { statements: 100, branches: 95, functions: 100, lines: 100 },
    },
  },
})
