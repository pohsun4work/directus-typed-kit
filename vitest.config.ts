import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
})
