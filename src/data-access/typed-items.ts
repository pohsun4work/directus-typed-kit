import type { OmitConcealed, StripConceal } from '../schema/conceal.js'
import type { StripDate } from '../schema/dates.js'
import type { IsRelation, RelObject } from '../schema/relation.js'

/** 放寬成 object 而非 Record<string, Record<string, unknown>>：\
 *  Schema 是 interface + Row[] 形狀，過不了「string index signature」與「值為物件」兩道約束
 */
export type SchemaShape = object

/** 攤平 intersection，hover 顯示乾淨 */
type Prettify<T> = { [K in keyof T]: T[K] } & {}

type RelPrefix<F extends string> = F extends `${infer R}.${string}` ? R : never
type SubFields<F extends string, R extends string> = F extends `${R}.${infer Sub}` ? Sub : never

/** `[T] extends [...]` 非分配式：避免 m2o 的 FK（string）那支被分配出 `{ field: never }` 假分支 */
type ApplyNested<T, F extends string>
  = [T] extends [readonly unknown[]]
    ? ApplyFields<RelObject<T>, F>[]
    : ApplyFields<RelObject<T>, F> | Extract<T, null | undefined>

/** 關聯欄位直接選取（無子欄位）時 runtime 只回 FK，故剝掉展開的物件收斂成 FK\
 *  `[T] extends [...]` 非分配式：o2m `string[] | Row[]` 須整段判斷，否則 Row[] 那支算出 `never[]`
 */
type FkOf<T> = [T] extends [readonly (infer E)[]] ? Exclude<E, object>[] : Exclude<T, object>
/** service read 各 temporal runtime 全回 string，故 strip 日期 brand 對齊 */
type DirectField<Item, K extends keyof Item>
  = IsRelation<Item[K]> extends true ? FkOf<Item[K]> : StripDate<Item[K]>

/** 星號要先 `Omit` 掉已被 `NestedPart` 接管的關聯鍵，\
 *  否則同鍵撞出 `FK & 展開 row` 這種 runtime 不存在的交集
 */
type DirectPart<Item, F extends string>
  = '*' extends F
    ? Omit<DefaultRead<Item>, RelPrefix<F> & keyof Item>
    : { [K in (F & keyof Item)]: DirectField<Item, K> }

type NestedPart<Item, F extends string> = {
  [R in (RelPrefix<F> & keyof Item & string)]: ApplyNested<Item[R], SubFields<F, R>>;
}

type Decr<N extends number> = N extends 2 ? 1 : 0

/** 非分配式理由同 ApplyNested */
type ExpandRel<T, D extends number>
  = [T] extends [readonly (infer E)[]]
    ? ExpandAll<Extract<E, object>, D>[]
    : ExpandAll<Extract<NonNullable<T>, object>, D> | Extract<T, null | undefined>

type ExpandAll<Item, D extends number>
  = Prettify<{
    [K in keyof Item]: IsRelation<Item[K]> extends true
      ? (D extends 0 ? FkOf<Item[K]> : ExpandRel<Item[K], Decr<D>>)
      : StripDate<Item[K]>;
  }>

/** 無 '*.*' 系列時回 unknown —— intersection 的單位元，不貢獻欄位 */
type StarPart<Item, F extends string>
  = '*.*.*' extends F ? ExpandAll<Item, 2>
    : '*.*' extends F ? ExpandAll<Item, 1>
      : unknown

/** 星號混明列 / 混點記時 intersection 精度有限，建議擇一（純星號或純明列） */
export type ApplyFields<Item, F extends string>
  = Prettify<DirectPart<Item, F> & NestedPart<Item, F> & StarPart<Item, F>>

/** 巢狀點記路徑（不含星號），`D` 為關聯還能再往下展開幾層\
 *  上限存在是因為自參照關聯（`parent: Folder`）會無限遞迴，且 union 隨層數指數成長；\
 *  取 2 即 `a.b.c` 三段，與 fields 的 `'*.*.*'` 三層星號對稱
 */
type DotPath<Item, D extends number>
  = | (keyof Item & string)
    | (D extends 0
      ? never
      : {
          [K in keyof Item & string]: IsRelation<Item[K]> extends true
            ? `${K}.${DotPath<RelObject<Item[K]>, Decr<D>>}`
            : never;
        }[keyof Item & string])

/** `rel.*`（展開該關聯全部欄位）另列：DotPath 只產具名欄位 */
type StarPath<Item> = {
  [K in keyof Item & string]: IsRelation<Item[K]> extends true ? `${K}.*` : never;
}[keyof Item & string]

type FieldPath<Item> = '*' | '*.*' | '*.*.*' | DotPath<Item, 2> | StarPath<Item>

type SortPath<Item> = `${'-' | ''}${DotPath<Item, 2>}`

/** 只 cover 常用 operator，其餘未列 */
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

/** 日期比較值套 StripDate 收純 string，呼叫端直接塞 ISO 字串、免外露日期 brand */
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
  /** `-` 前綴為降冪，巢狀排序（`folder.name`）深度上限同 fields 的點記 */
  sort?: readonly SortPath<Item>[] | SortPath<Item>;
  limit?: number;
  offset?: number;
  page?: number;
  search?: string;
}

/** 讀取結果欄位恆在、值可能 null，故 Schema 寫 `field?: T | null` 時去 optional 並剝 undefined\
 *  不正規化則兩條讀取路徑不一致：`DefaultRead` 是 homomorphic mapping、保留 optional modifier，\
 *  而 `DirectPart` 的 key 集合換成 `F & keyof Item`、modifier 不保留
 */
type NormalizeRow<Row> = { [K in keyof Row]-?: Exclude<Row[K], undefined> }

/** Schema 慣例：一般集合寫 `Row[]`、singleton 寫裸 `Row`，此處一律解成 Row */
export type CollectionItem<S, C extends keyof S>
  = NormalizeRow<S[C] extends readonly (infer I)[] ? I : S[C]>

type ServiceRow<S, C extends keyof S> = OmitConcealed<CollectionItem<S, C>>

/** 消費端覆寫槽，未覆寫者走各型別自帶的 fallback */
export interface KitTypes {}

/** 註冊一次專案 Schema → createHook / createEndpoint 免逐次帶泛型\
 *  `declare module 'directus-typed-kit' { interface KitSchema { schema: Schema } }`\
 *  未註冊 → fallback SchemaShape → collection 收斂 never、呼叫即型別錯（逼補註冊，不靜默放寬）
 */
export interface KitSchema {}

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

/** 對齊 PayloadService 的 deep-write：巢狀帶 PK → update、無 PK → create */
type WriteRelation<T>
  = [T] extends [readonly (infer E)[]]
    ? (Exclude<E, object> | WritePayload<RelObject<T>>)[] | Extract<T, null>
    : FkOf<T> | WritePayload<RelObject<T>>

type WriteField<T> = IsRelation<T> extends true ? WriteRelation<T> : StripConceal<StripDate<T>>

/** 去 readonly 是必要的：generator 產的 Schema 常帶 readonly，\
 *  而 hook handler 內 `payload.x = v` 是主流寫法
 */
export type WritePayload<Item> = { -readonly [K in keyof Item]?: WriteField<Item[K]> }

/** F 退化成寬 `string`（fields 來自 `string[]` 變數）時退回 DefaultRead：\
 *  `'*'` 與 `'*.*.*'` 都 extends string，直接套 ApplyFields 會讓明列與星號兩半同時生效、\
 *  交出 `FK & 展開 row` 這種無值可滿足的交集
 */
type Read<Item, Q>
  = Q extends { fields: readonly (infer F extends string)[] }
    ? (string extends F ? DefaultRead<Item> : ApplyFields<Item, F>)
    : DefaultRead<Item>

/** `emitEvents` 語義同 WriteOptions */
export interface ReadOptions {
  emitEvents?: boolean;
  stripNonRequested?: boolean;
}

/** runtime 是原生 ItemsService 實例，items() 以邊界 cast 成此型別、不 subclass\
 *  讀寫兩個 row 分開：讀取視角移除 conceal 欄位，寫入視角保留但脫 brand
 */
export interface TypedItemsService<
  S extends SchemaShape,
  C extends keyof S,
  Item = ServiceRow<S, C>,
  Key = Item extends { id: infer K } ? K & PrimaryKey : PrimaryKey,
  Payload = WritePayload<CollectionItem<S, C>>
> {
  readByQuery: <const Q extends Query<Item>>(query: Q, opts?: ReadOptions) => Promise<Read<Item, Q>[]>;
  readOne: <const Q extends Query<Item>>(key: Key, query?: Q, opts?: ReadOptions) => Promise<Read<Item, Q>>;
  readMany: <const Q extends Query<Item>>(keys: Key[], query?: Q, opts?: ReadOptions) => Promise<Read<Item, Q>[]>;
  /** singleton collection（Schema 寫裸 `Row` 而非 `Row[]`）專用，未設定過時欄位可能缺席故回 Partial */
  readSingleton: <const Q extends Query<Item>>(query: Q, opts?: ReadOptions) => Promise<Partial<Read<Item, Q>>>;
  getKeysByQuery: (query: Query<Item>) => Promise<Key[]>;

  createOne: (payload: Payload, opts?: WriteOptions) => Promise<Key>;
  createMany: (payloads: Payload[], opts?: WriteOptions) => Promise<Key[]>;

  updateOne: (key: Key, payload: Payload, opts?: WriteOptions) => Promise<Key>;
  updateMany: (keys: Key[], payload: Payload, opts?: WriteOptions) => Promise<Key[]>;
  updateByQuery: (query: Query<Item>, payload: Payload, opts?: WriteOptions) => Promise<Key[]>;
  /** 逐筆 payload 各自帶 PK，一次更新多筆不同內容 */
  updateBatch: (payloads: Payload[], opts?: WriteOptions) => Promise<Key[]>;

  /** payload 帶 PK 即 update、無則 create */
  upsertOne: (payload: Payload, opts?: WriteOptions) => Promise<Key>;
  upsertMany: (payloads: Payload[], opts?: WriteOptions) => Promise<Key[]>;
  upsertSingleton: (payload: Payload, opts?: WriteOptions) => Promise<Key>;

  deleteOne: (key: Key, opts?: WriteOptions) => Promise<Key>;
  deleteMany: (keys: Key[], opts?: WriteOptions) => Promise<Key[]>;
  deleteByQuery: (query: Query<Item>, opts?: WriteOptions) => Promise<Key[]>;
}
