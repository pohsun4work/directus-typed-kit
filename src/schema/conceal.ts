// password / token / tfa_secret… 這類欄位
// - service → 遮蔽字串 '**********'（非真值）
// - knex → 真值

/** conceal 欄位 brand 載體（runtime 不存在；conceal 欄位恆為 string，故不帶型別參數） */
export type Concealed = string & { readonly __directusConceal: true }

/** 某欄位型別是否含 conceal brand（聯集任一成員帶 brand 即是；剝 null 後判斷） */
export type IsConcealed<T> = [Extract<NonNullable<T>, { readonly __directusConceal: true }>] extends [never]
  ? false
  : true

/** service 視角：移除 conceal 欄位（型別上擋掉、逼呼叫端改走 raw knex 取真值） */
export type OmitConcealed<Row> = { [K in keyof Row as IsConcealed<Row[K]> extends true ? never : K]: Row[K] }

/** knex 視角：conceal 欄位還原為真實 string（剝 brand，分配律保留 `| null`） */
export type StripConceal<T> = T extends { readonly __directusConceal: true } ? string : T
