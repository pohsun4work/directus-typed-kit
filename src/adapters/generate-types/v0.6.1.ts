// 版本檔：generate-types 0.6.1（及同輸出結構版本）的轉換
// generator 自包含、容器已是 Row[]、關聯 string | Row，故本轉換只做：標 conceal brand、套 Overrides、正規化 nullable optional

import type { Concealed } from '../../schema/conceal.js'
import type { BrandMap, TemporalKind } from '../../schema/dates.js'
import type { ConcealedOf } from '../conceal-fields.js'

// 單一欄位 branding（優先序）：
//   1. Overrides 指定：值是 TemporalKind 字面量 → date brand；否則當「明確型別」逐字採用
//   2. conceal 欄位 → Concealed brand
//   3. 其餘原樣穿透
type BrandField<T, Conceal, Override, K>
  = K extends keyof Override
    ? (Override[K] extends TemporalKind ? BrandMap[Override[K]] | Extract<T, null> : Override[K])
    : K extends Conceal
      ? Concealed | Extract<T, null>
      : T

// generate-types 對 nullable 欄位用 `field?: T | null`（→ T | null | undefined）
// `-?` 去 optional 並 Exclude undefined，正規化成 `field: T | null`（讀取結果欄位恆在、值可能 null）
type BrandRow<Row, Conceal, Override>
  = { [K in keyof Row]-?: Exclude<BrandField<Row[K], Conceal, Override, K>, undefined> }

// 取某 collection 的 Override 子映射（未指定則空）
type OverrideOf<Overrides, C> = C extends keyof Overrides ? Overrides[C] : Record<never, never>

/** generate-types 此世代產出 → kit 形狀\
 *  逐 collection 套 override + conceal brand；容器 `Row[]` 與 singleton（如 settings）皆處理
 */
export type Transform<S, Overrides> = {
  [C in keyof S]: S[C] extends readonly (infer Row)[]
    ? BrandRow<Row, ConcealedOf<C>, OverrideOf<Overrides, C>>[]
    : BrandRow<S[C], ConcealedOf<C>, OverrideOf<Overrides, C>>
}
