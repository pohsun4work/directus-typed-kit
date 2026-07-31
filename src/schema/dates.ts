// 日期時間欄位在 items/SDK 與 knex/pg 型別不同，各 brand 記兩邊契約

import type { IsConcealed } from './conceal.js'
import type { IsRelation, RelObject, RelScalar } from './relation.js'

type DateBrand<Tag extends string> = string & { readonly __directusDate: Tag }

/** `timestamp`（UTC）
 *  - API  → ISO 帶 Z
 *  - knex → `Date`
 */
export type Timestamp = DateBrand<'timestamp'>
/** `dateTime`（無時區）
 *  - API  → ISO 不帶 Z
 *  - knex → `Date`
 */
export type DateTime = DateBrand<'dateTime'>
/** `date`
 *  - API  → `YYYY-MM-DD`
 *  - knex → `Date`
 */
export type DateOnly = DateBrand<'date'>
/** `time`
 *  - API  → `HH:mm:ss`
 *  - knex → `string`（node-pg 把 time 當字串）
 */
export type TimeOnly = DateBrand<'time'>

/** items/SDK 視角，讀寫都當純字串 */
export type StripDate<T>
  = T extends { readonly __directusDate: string }
    ? string
    : T extends readonly (infer E)[] ? StripDate<E>[] : T

/** knex 視角單欄型別（o2m 欄位已於 KnexView 移除，不會進此），各分支欄位種類對應的 knex 型別
 * - conceal（password…）→ 還原真實 `string`（必須先擋，避免被判成關聯）
 * - `time` → `string`
 * - 其餘日期 → `Date`
 * - csv/enum 陣列（元素為 string/number/boolean，join 得起來）→ `string`（DB 存逗號字串）
 * - JSON 陣列（元素非純量）→ 原樣
 * - m2o 關聯（FK 純量＋展開 row）→ FK
 * - 純量 JSON 物件（有 object 但無純量成員，如 revisions.data）→ 原樣（DB 存 JSON、非關聯）
 * - 其餘純量 → 原樣
 *
 * nullable 欄位須先 `NonNullable` 再判陣列，否則 `T[] | null` 這種聯集不 assignable 給陣列會誤走關聯分支
 */
export type KnexField<T>
  = IsConcealed<T> extends true
    ? string | Extract<T, null>
    : [Extract<T, { readonly __directusDate: 'time' }>] extends [never]
        ? [Extract<T, { readonly __directusDate: string }>] extends [never]
            ? [NonNullable<T>] extends [readonly (infer E)[]]
                ? [Exclude<E, string | number | boolean>] extends [never] ? string | Extract<T, null> : T
                : [RelObject<T>] extends [never]
                    ? T
                    : [RelScalar<T>] extends [never]
                        ? T
                        : RelScalar<T> | Extract<T, null>
            : Date | Extract<T, null>
        : string | Extract<T, null>

/** o2m/m2m 的 FK 在 child 表，parent 表無此欄 knex select 取不到，故視角移除
 * 先 `NonNullable` 剝 null，否則 nullable o2m（`string[] | Row[] | null`）偵測不到而漏刪
 */
type IsKnexAbsent<T> = [NonNullable<T>] extends [readonly unknown[]] ? IsRelation<T> : false

/** Schema row 映射為 knex 視角 row，o2m 欄位移除（FK 不在本表 select 取不到） */
export type KnexView<Item> = {
  [K in keyof Item as IsKnexAbsent<Item[K]> extends true ? never : K]: KnexField<Item[K]>
}
