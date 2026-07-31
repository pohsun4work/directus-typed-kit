// conceal 欄位（password / token / tfa_secret…）兩視角回不同值
//  - service → 遮蔽字串 '**********'（非真值）
//  - knex    → 真值

/** brand 載體，runtime 不存在 */
export type Concealed = string & { readonly __directusConceal: true }

/** `0 extends 1 & T` 先擋 any：`Extract<any, Brand>` 算出 any、過不了 `[…] extends [never]`，\
 *  不擋則 Schema 寫 `field: any` 的欄位被判成 conceal、從讀取視角靜默消失
 */
export type IsConcealed<T> = 0 extends 1 & T
  ? false
  : [Extract<NonNullable<T>, { readonly __directusConceal: true }>] extends [never]
      ? false
      : true

/** 型別上擋掉，逼呼叫端改走 raw knex 取真值 */
export type OmitConcealed<Row> = { [K in keyof Row as IsConcealed<Row[K]> extends true ? never : K]: Row[K] }

/** 遮蔽只發生在讀取，寫進去的恆是明文 string（hook 雜湊密碼即靠這條） */
export type StripConceal<T> = T extends { readonly __directusConceal: true } ? string : T
