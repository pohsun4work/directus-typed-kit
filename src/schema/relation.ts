// 關聯偵測判準，service 與 knex 兩視角共用 —— 各寫一套會漂移（json 欄位在一側判成關聯、另一側沒有）
// Schema 契約規定 m2o 寫 `string | Row`、o2m 寫 `string[] | Row[]`，故關聯恆帶 FK 那半邊的純量
// json 欄位（物件或物件陣列）沒有純量那半，據此與關聯分流

/** 剝掉 branded string（日期 / conceal 型別上也是 object）後仍是物件的成員 */
type RowLike<T> = Exclude<Extract<T, object>, string>

/** 關聯目標 row，非關聯得 never */
export type RelObject<T> = T extends readonly (infer E)[] ? RowLike<E> : RowLike<NonNullable<T>>

/** FK 那半邊的純量成員，json 欄位得 never */
export type RelScalar<T>
  = T extends readonly (infer E)[]
    ? Exclude<E, RowLike<E>>
    : Exclude<NonNullable<T>, RowLike<NonNullable<T>>>

/** row 與 FK 純量兩半俱全才算關聯 */
export type IsRelation<T>
  = [RelObject<T>] extends [never]
    ? false
    : [RelScalar<T>] extends [never] ? false : true
