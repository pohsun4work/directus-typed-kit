// directus-extension-generate-types 產出 → kit Schema 入口
//
// 產物本就接近 kit contract，故本適配器精簡：
//   - 系統表已含完整欄位，無需另補
//   - 容器已是 Row[]、關聯為 string | Row，不需轉換
//   - 日期為純 string（無 marker），要 knex 拿到 brand 型別（日期多為 Date、time 為 string）須用 Overrides 逐欄顯式標，未標者兩視角皆 string

import type { Transform as V0_6_1 } from './v0.6.1.js'

// 支援版本清單，採用新版時把版本字串加進聯集，不指定則用 Latest
type GenerateTypesVersion = '0.6.1'
type Latest = '0.6.1'

/** 版本 → 版本檔，結構相同的版本共用一檔，結構變了才新增 v<新版>.ts 並在此加分支 */
type StructureOf<V extends GenerateTypesVersion, S, Overrides> = V extends '0.6.1' ? V0_6_1<S, Overrides> : never

/** generate-types 的 root（CustomDirectusTypes）→ kit Schema\
 *  第二參數填版本或直接填 Overrides（省略版本＝Latest）
 *  - `<Types>` / `<Types, Overrides>` / `<Types, '0.6.1', Overrides>`
 *
 *  Overrides 形狀 `{ collection: { field: 值 } }`，每欄的值二擇一：
 *    - TemporalKind 字面量 → 日期 brand 捷徑（service 恆 string、knex 依 kind 分流 timestamp/dateTime/date 為 Date、time 仍 string）
 *    - 任意明確型別 → 逐字採用，補 generate-types typed 不準的欄位（csv / o2m FK / json…）
 */
export type FromGenerateTypes<
  S,
  VersionOrOverrides extends GenerateTypesVersion | { [C in keyof S]?: Record<string, unknown> } = Latest,
  Overrides extends { [C in keyof S]?: Record<string, unknown> } = Record<never, never>
> = VersionOrOverrides extends GenerateTypesVersion
  ? StructureOf<VersionOrOverrides, S, Overrides>
  : StructureOf<Latest, S, VersionOrOverrides>
