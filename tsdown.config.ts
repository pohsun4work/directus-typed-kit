import { defineConfig } from 'tsdown'

export default defineConfig({
  // 每個對外子路徑各一個 entry，意義在 treeshake
  entry: [
    'src/index.ts',
    'src/hook/index.ts',
    'src/endpoint/index.ts',
    'src/adapters/ts-typegen/index.ts',
    'src/adapters/generate-types/index.ts',
  ],
  format: ['esm'],
  platform: 'node',
  dts: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  deps: {
    // knex → dts bundler inline knex result.d.ts 的非 type default import 會報 MISSING_EXPORT
    // express → 型別由消費端提供
    // @directus/types → root re-export 牽進 @types/archiver 的 MISSING_EXPORT（同 knex）
    // @directus/sdk 不列入 → 型別 inline 進產物，消費端免裝 sdk
    neverBundle: ['knex', 'express', '@directus/types'],
    // runtime value import 只有 @directus/errors / extensions-sdk 兩個 peerDep（tsdown 本就外置）
    // 唯一被打包的是 dts 層 inline @directus/sdk 型別，屬刻意；關掉 tsdown 對「bundle 了 dep」的保守提醒
    onlyBundle: false,
  },
})
