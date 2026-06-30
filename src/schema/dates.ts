// 日期&時間欄位在 items / SDK 跟 knex/pg 有型別差異，需要轉換

import type { IsConcealed } from './conceal.js'

/** `Tag` 記 Directus 型別名 */
type DateBrand<Tag extends string> = string & { readonly __directusDate: Tag }

/** `timestamp`：UTC
 * - API 回 ISO 帶 Z
 * - knex → Date
 */
export type Timestamp = DateBrand<'timestamp'>
/** `dateTime`：無時區
 * - API 回 ISO 不帶 Z
 * - knex → Date
 */
export type DateTime = DateBrand<'dateTime'>
/** `date`
 * - API 回 `YYYY-MM-DD`
 * - knex → Date
 */
export type DateOnly = DateBrand<'date'>
/** `time`
 * - API 回 `HH:mm:ss`
 * - knex → **string**（node-pg 把 time 當字串）
 */
export type TimeOnly = DateBrand<'time'>

/** 各 generator 適配器標日期欄位使用 */
export interface BrandMap {
  timestamp: Timestamp;
  dateTime: DateTime;
  date: DateOnly;
  time: TimeOnly;
}
export type TemporalKind = keyof BrandMap

/** items / SDK 視角，讀寫都當純字串 */
export type StripDate<T> = T extends { readonly __directusDate: string } ? string : T

/** knex 視角單欄型別（o2m 欄位已於 KnexView 移除，不會進此）
 * - conceal（password…） → 還原真實 `string`（必須先擋，避免被判成關聯）
 * - `time` → `string`；其餘日期 → `Date`
 * - 陣列（csv / enum）→ `string`（DB 存逗號字串）
 * - m2o 關聯 → FK
 * - 其餘純量原樣
 */
export type KnexField<T>
  = IsConcealed<T> extends true
    ? string | Extract<T, null>
    : [Extract<T, { readonly __directusDate: 'time' }>] extends [never]
        ? [Extract<T, { readonly __directusDate: string }>] extends [never]
            ? [T] extends [readonly unknown[]]
                ? string | Extract<T, null>
                : [Exclude<Extract<NonNullable<T>, object>, string>] extends [never]
                    ? T
                    : Exclude<NonNullable<T>, object> | Extract<T, null>
            : Date | Extract<T, null>
        : string | Extract<T, null>

/** o2m / m2m：陣列且元素含關聯 row（FK 在 child 表）→ parent 表無此欄，knex select 取不到，故視角移除 */
type IsKnexAbsent<T> = [T] extends [readonly (infer E)[]]
  ? [Exclude<Extract<E, object>, string>] extends [never] ? false : true
  : false

/** Schema row → knex 視角 row（o2m 欄位移除：FK 不在本表、select 取不到） */
export type KnexView<Item> = {
  [K in keyof Item as IsKnexAbsent<Item[K]> extends true ? never : K]: KnexField<Item[K]>
}
