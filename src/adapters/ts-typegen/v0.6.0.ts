// 版本檔：ts-typegen 0.6.0（及同輸出結構版本）的轉換；日期欄位層轉換共用 brand.ts

import type { MapRow } from './brand.js'

/** ts-typegen 此世代產出 Schema → kit 形狀；唯一轉換是日期 "datetime" → brand（容器 Row[] / singleton 皆處理、關聯原樣）\
 *  Overrides `{ collection: { field: 'time' } }` 只在 knex view 會出錯的欄位（主要是 time）逐欄修正
 */
export type Transform<S, Overrides> = {
  [C in keyof S]: S[C] extends readonly (infer Row)[]
    ? MapRow<Row, C extends keyof Overrides ? Overrides[C] : Record<never, never>>[]
    : MapRow<S[C], C extends keyof Overrides ? Overrides[C] : Record<never, never>>
}
