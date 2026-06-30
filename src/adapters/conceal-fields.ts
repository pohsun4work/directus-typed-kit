// 系統表的 conceal 欄位是 Directus 事實、與 generator 無關
// 各適配器標 Concealed brand，core 再據 brand 分流
// 來源：@directus/system-data 欄位定義（Directus special:['conceal']，讀出被遮成 '**********'）

export interface ConcealedFieldMap {
  directus_users: 'password' | 'token' | 'tfa_secret';
  directus_shares: 'password';
}

/** 某 collection 的 conceal 欄位名（無則 never，`K extends never` 永遠 false → 全欄位原樣） */
export type ConcealedOf<C> = C extends keyof ConcealedFieldMap ? ConcealedFieldMap[C] : never
