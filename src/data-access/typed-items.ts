import type { OmitConcealed } from '../schema/conceal.js'
import type { StripDate } from '../schema/dates.js'

// 補原生 ItemsService 缺的兩塊型別：Query<Item> typed 輸入、ApplyFields fields→result 輸出推導
// runtime 仍是原生 ItemsService，items() 以邊界 cast 成 TypedItemsService，不 subclass

// 放寬成 object 而非 Record<string, Record<string, unknown>>：Schema 是 interface + Row[] 形狀，過不了「string index signature」與「值為物件」兩道約束
// 真正 row 由 CollectionItem 解出
export type SchemaShape = object

/** 取關聯欄位的物件型別（m2o / o2m 皆可）；非關聯 → never\
 *  排除可賦值給 string 者：branded string（日期 / conceal）型別上也是 object，不排除會被誤判成關聯
 */
type RelObject<T> = T extends readonly (infer E)[]
  ? Exclude<Extract<E, object>, string>
  : Exclude<Extract<NonNullable<T>, object>, string>
type IsRelation<T> = [RelObject<T>] extends [never] ? false : true

/** 攤平 intersection，hover 顯示乾淨 */
type Prettify<T> = { [K in keyof T]: T[K] } & {}

// fields→result 推導：fields 以 union 處理（tuple 經 const Q 取 [number]）
// 支援直接欄位、一層點記關聯（rel.field / rel.*）、星號 '*' / '*.*' / '*.*.*'；不支援多級點記 a.b.c

/** 關聯前綴：F 中所有 `${R}.${...}` 的 R */
type RelPrefix<F extends string> = F extends `${infer R}.${string}` ? R : never
/** 子路徑：`${R}.` 之後的部分（union） */
type SubFields<F extends string, R extends string> = F extends `${R}.${infer Sub}` ? Sub : never

/** 對關聯欄位套用子 fields，保留 o2m 陣列性、帶回 m2o 的 null\
 *  `[T] extends [...]` 非分配式：避免 m2o 的 FK（string）那支被分配出 `{ field: never }` 假分支
 */
type ApplyNested<T, F extends string>
  = [T] extends [readonly unknown[]]
    ? ApplyFields<RelObject<T>, F>[]
    : ApplyFields<RelObject<T>, F> | Extract<T, null | undefined>

/** 關聯欄位直接選取（無子欄位）時 runtime 只回 FK，故剝掉展開的物件收斂成 FK\
 *  `[T] extends [...]` 非分配式：o2m `string[] | Row[]` 須整段判斷，否則 Row[] 那支算出 `never[]`
 */
type FkOf<T> = [T] extends [readonly (infer E)[]] ? Exclude<E, object>[] : Exclude<T, object>
// 非關聯欄位 strip 日期 brand：service read 各 temporal runtime 全回 string，型別據此對齊免使用端拿 brand 當 string
type DirectField<Item, K extends keyof Item>
  = IsRelation<Item[K]> extends true ? FkOf<Item[K]> : StripDate<Item[K]>

/** 直接欄位（不含點）；'*' 走預設讀取、明列關聯欄位同樣收 FK */
type DirectPart<Item, F extends string>
  = '*' extends F ? DefaultRead<Item> : { [K in (F & keyof Item)]: DirectField<Item, K> }

/** 巢狀欄位（含點）：依關聯前綴分組展開 */
type NestedPart<Item, F extends string> = {
  [R in (RelPrefix<F> & keyof Item & string)]: ApplyNested<Item[R], SubFields<F, R>>;
}

// 星號展開：'*'→Depth 0（關聯收 FK）、'*.*'→1、'*.*.*'→2；每深一層展開關聯 row 再 Depth-1

type Decr<N extends number> = N extends 2 ? 1 : 0

/** 展開單一關聯欄位到指定深度（保留 o2m 陣列性與 m2o 的 null）；非分配式理由同 ApplyNested */
type ExpandRel<T, D extends number>
  = [T] extends [readonly (infer E)[]]
    ? ExpandAll<Extract<E, object>, D>[]
    : ExpandAll<Extract<NonNullable<T>, object>, D> | Extract<T, null | undefined>

/** 把 Item 所有關聯欄位展開到 Depth 層（Depth 0 → 收 FK，等同 DefaultRead） */
type ExpandAll<Item, D extends number>
  = Prettify<{
    [K in keyof Item]: IsRelation<Item[K]> extends true
      ? (D extends 0 ? FkOf<Item[K]> : ExpandRel<Item[K], Decr<D>>)
      : StripDate<Item[K]>;
  }>

/** 依 fields 內最深的星號決定展開深度；無 '*.*' 系列回 unknown（intersection 單位元，不貢獻欄位） */
type StarPart<Item, F extends string>
  = '*.*.*' extends F ? ExpandAll<Item, 2>
    : '*.*' extends F ? ExpandAll<Item, 1>
      : unknown

/** 主推導：Item × fields(union) → 結果型別\
 *  星號混明列 / 混點記時 intersection 精度有限，建議擇一（純星號或純明列）
 */
export type ApplyFields<Item, F extends string>
  = Prettify<DirectPart<Item, F> & NestedPart<Item, F> & StarPart<Item, F>>

// === typed Query 輸入 ===

/** 合法 fields 字串：根欄位 / 星號（最多 3 層）/ 一層關聯點記（rel.field 或 rel.*） */
type FieldPath<Item>
  = | '*' | '*.*' | '*.*.*'
    | (keyof Item & string)
    | {
      [K in keyof Item & string]: IsRelation<Item[K]> extends true
        ? `${K}.${(keyof RelObject<Item[K]> & string) | '*'}`
        : never;
    }[keyof Item & string]

/** 簡化版 filter operator（cover 常用；其餘可再補） */
interface FilterOperators<V> {
  _eq?: V;
  _neq?: V;
  _in?: V[];
  _nin?: V[];
  _gt?: V;
  _gte?: V;
  _lt?: V;
  _lte?: V;
  _null?: boolean;
  _nnull?: boolean;
  _contains?: string;
  _icontains?: string;
  _starts_with?: string;
  _ends_with?: string;
}

/** typed filter：欄位 → operator、_and / _or 組合；關聯可遞迴或直接比 FK/PK\
 *  日期比較值套 StripDate 收純 string，呼叫端直接塞 ISO 字串、免外露日期 brand
 */
export type Filter<Item>
  = | { _and?: Filter<Item>[]; _or?: Filter<Item>[] }
    | {
      [K in keyof Item & string]?: IsRelation<Item[K]> extends true
        ? Filter<RelObject<Item[K]>> | FilterOperators<PrimaryKey>
        : FilterOperators<StripDate<Item[K]>>;
    }

export interface Query<Item> {
  fields?: readonly FieldPath<Item>[];
  filter?: Filter<Item>;
  sort?: readonly `${'-' | ''}${keyof Item & string}`[] | (keyof Item & string);
  limit?: number;
  offset?: number;
  page?: number;
  search?: string;
}

// === TypedItemsService ===

/** 取某 collection 單筆 row：一般集合是 Row[]、singleton 是 Row，一律解成 Row */
export type CollectionItem<S, C extends keyof S> = S[C] extends readonly (infer I)[] ? I : S[C]

/** service 視角 row：移除 conceal 欄位（讀出非真值）；系統表完整欄位由 generator 適配器灌入，core 只依 brand 處理 */
type ServiceRow<S, C extends keyof S> = OmitConcealed<CollectionItem<S, C>>

/** 消費端可覆寫的型別槽（module augmentation），預設留空、各型別以 fallback 給預設 */
export interface KitTypes {}

/** 註冊一次專案 Schema → createHook / createEndpoint 免逐次帶泛型\
 *  `declare module 'directus-kit' { interface KitSchema { schema: Schema } }`\
 *  未註冊 → fallback SchemaShape → collection 收斂 never、呼叫即型別錯（逼補註冊，不靜默放寬）
 */
export interface KitSchema {}

/** 已註冊的 Schema；createHook / createEndpoint 泛型預設值（internal） */
export type RegisteredSchema = KitSchema extends { schema: infer S extends SchemaShape } ? S : SchemaShape

/** collection 主鍵型別，預設 `string | number`（uuid 或自增整數）\
 *  全 uuid 專案可覆寫成 string 省去回傳 `as string`：`interface KitTypes { PrimaryKey: string }`
 */
export type PrimaryKey
  = KitTypes extends { PrimaryKey: infer P extends string | number } ? P : string | number

/** ItemsService 變更方法的選用 opts\
 *  `emitEvents:false` → 該次寫入不發事件（hook 寫自身 collection 斷遞迴用，代價是跳過該寫入的所有 hook）\
 *  其餘為快取 / 限制旁路
 */
export interface WriteOptions {
  emitEvents?: boolean;
  autoPurgeCache?: boolean;
  autoPurgeSystemCache?: boolean;
  bypassLimits?: boolean;
}

/** 未明列 fields 的預設讀取：Directus 不展開關聯，故型別把關聯欄位收 FK 對齊 runtime */
type DefaultRead<Item> = Prettify<{ [K in keyof Item]: DirectField<Item, K> }>

/** 寫入時關聯欄位允許 FK 或巢狀 partial（對齊 PayloadService deep-write：巢狀帶 PK→update、無 PK→create）
 *  - m2o → `FK | 巢狀`（FkOf 帶回 null）
 *  - o2m → `(FK | 巢狀)[]`，元素逐筆可混 FK 與巢狀
 */
type WriteRelation<T>
  = [T] extends [readonly (infer E)[]]
    ? (Exclude<E, object> | WritePayload<RelObject<T>>)[] | Extract<T, null>
    : FkOf<T> | WritePayload<RelObject<T>>

type WriteField<T> = IsRelation<T> extends true ? WriteRelation<T> : StripDate<T>

/** deep-write payload：欄位 optional、關聯收 FK 或巢狀 partial、日期脫成 string（呼叫端直接塞 ISO 字串） */
export type WritePayload<Item> = Partial<{ [K in keyof Item]: WriteField<Item[K]> }>

/** 依 fields 推結果；無 fields → 預設投影（關聯為 FK） */
type Read<Item, Q> = Q extends { fields: readonly (infer F extends string)[] } ? ApplyFields<Item, F> : DefaultRead<Item>

/** 完整 typed 的 ItemsService（runtime 為原生實例的邊界 cast 目標）\
 *  const Q 保留 fields 字面量才能推精準結果；Key 由 Schema 的 id 欄位推導
 */
export interface TypedItemsService<
  S extends SchemaShape,
  C extends keyof S,
  Item = ServiceRow<S, C>,
  Key = Item extends { id: infer K } ? K & PrimaryKey : PrimaryKey
> {
  readByQuery: <const Q extends Query<Item>>(query: Q) => Promise<Read<Item, Q>[]>;
  readOne: <const Q extends Query<Item>>(key: Key, query?: Q) => Promise<Read<Item, Q>>;
  readMany: <const Q extends Query<Item>>(keys: Key[], query?: Q) => Promise<Read<Item, Q>[]>;

  createOne: (payload: WritePayload<Item>, opts?: WriteOptions) => Promise<Key>;
  createMany: (payloads: WritePayload<Item>[], opts?: WriteOptions) => Promise<Key[]>;

  updateOne: (key: Key, payload: WritePayload<Item>, opts?: WriteOptions) => Promise<Key>;
  updateMany: (keys: Key[], payload: WritePayload<Item>, opts?: WriteOptions) => Promise<Key[]>;
  updateByQuery: (query: Query<Item>, payload: WritePayload<Item>, opts?: WriteOptions) => Promise<Key[]>;

  deleteOne: (key: Key, opts?: WriteOptions) => Promise<Key>;
  deleteMany: (keys: Key[], opts?: WriteOptions) => Promise<Key[]>;
  deleteByQuery: (query: Query<Item>, opts?: WriteOptions) => Promise<Key[]>;
}
