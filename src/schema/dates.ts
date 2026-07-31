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

/** 與 Schema 宣告不一致的幾支：
 * - conceal（password…）→ 還原真實 `string`（須先擋，否則被判成關聯）
 * - `time` → `string`
 * - csv/enum 陣列 → `string`（DB 存逗號字串）
 *
 * any 最先擋掉原樣放行：每道 `Extract` 對它都算出 any，會一路落到日期分支被收成 `string`
 *
 * nullable 欄位須先 `NonNullable` 再判陣列，否則 `T[] | null` 這種聯集不 assignable 給陣列會誤走關聯分支
 */
export type KnexField<T>
  = 0 extends 1 & T
    ? T
    : IsConcealed<T> extends true
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

export type KnexView<Item> = {
  [K in keyof Item as IsKnexAbsent<Item[K]> extends true ? never : K]: KnexField<Item[K]>
}
