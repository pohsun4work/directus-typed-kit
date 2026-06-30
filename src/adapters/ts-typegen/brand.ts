// 日期 brand 機器：各版本檔共用的欄位／列層轉換（與輸出結構無關，故抽成輔助檔）
// ts-typegen 把四種 temporal 欄位一律 emit 成字面量 "datetime"（subtype 已抹平），日期欄位即以此 marker 偵測
//
// 為什麼預設對到 Timestamp：實測（Directus 11.17 + node-pg）
// - service：各 temporal 全回 string
// - knex：timestamp/dateTime/date → Date、time → string
// Timestamp brand（service=string、knex=Date）對前三者皆正確，唯一不同的 time 需用 Overrides 指定

import type { BrandMap, TemporalKind } from '../../schema/dates.js'

/** 某欄位的 temporal 種類：Override 指定者用之，否則預設 timestamp */
export type KindOf<O, K extends PropertyKey>
  = K extends keyof O ? (O[K] extends TemporalKind ? O[K] : 'timestamp') : 'timestamp'

/** "datetime" 字面量 → brand（分配律保留 `| null` 等聯集成員）；非日期欄位原樣穿透 */
export type MapField<T, Kind extends TemporalKind> = T extends 'datetime' ? BrandMap[Kind] : T

export type MapRow<Row, O> = { [K in keyof Row]: MapField<Row[K], KindOf<O, K>> }
