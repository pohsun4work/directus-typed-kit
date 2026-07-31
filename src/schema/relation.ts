// 關聯偵測判準，service 與 knex 兩視角共用 —— 各寫一套會漂移（json 欄位在一側判成關聯、另一側沒有）
// Schema 契約規定 m2o 寫 `string | Row`、o2m 寫 `string[] | Row[]`，故關聯恆帶 FK 那半邊的純量
// json 欄位（物件或物件陣列）沒有純量那半，據此與關聯分流

/** 日期 / conceal 這類 branded string 在型別上也算 object，不剝會被判成關聯 row */
type RowLike<T> = Exclude<Extract<T, object>, string>

export type RelObject<T> = T extends readonly (infer E)[] ? RowLike<E> : RowLike<NonNullable<T>>

export type RelScalar<T>
  = T extends readonly (infer E)[]
    ? Exclude<E, RowLike<E>>
    : Exclude<NonNullable<T>, RowLike<NonNullable<T>>>

/** any 先擋：RelObject / RelScalar 對它都算出 any，兩道 never 檢查全過、整欄被判成關聯 */
export type IsRelation<T>
  = 0 extends 1 & T
    ? false
    : [RelObject<T>] extends [never]
        ? false
        : [RelScalar<T>] extends [never] ? false : true
