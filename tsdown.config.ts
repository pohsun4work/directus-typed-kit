import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/hook/index.ts',
    'src/endpoint/index.ts',
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
    neverBundle: ['knex', 'express', '@directus/types'],
    // runtime value import 只有 @directus/errors / extensions-sdk 兩個 peerDep（tsdown 本就外置）
    // 唯一被打包的是 dts 層 inline @standard-schema/spec 型別，屬刻意（消費端免裝）；關掉 tsdown 的保守提醒
    onlyBundle: false,
  },
})
