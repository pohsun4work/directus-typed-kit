import { defineConfig } from 'vitest/config'

// 型別測試為主
// 測試集中於 test/，與 src 實作分離（*.test-d.ts 型別、*.test.ts runtime）
export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
    include: ['test/**/*.test.ts'],
  },
})
