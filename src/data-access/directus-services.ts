// service 工廠集合的兩類 key：
//   1. 內建特化 service（FilesService / AssetsService…）→ runtime 用同名注入 class 建構、不帶 collection
//   2. 其餘 Schema collection → `${Pascal(C)}Service` 工廠 → runtime 走 ItemsService(C)

import type { Accountability, Identity } from '../core/types.js'
import type { PrimaryKey, Query, ReadOptions, SchemaShape, TypedItemsService, WriteOptions } from './typed-items.js'
import type { Knex } from 'knex'

/** service 工廠 / items() 的執行身分：三種快捷字面量，或給部分 Accountability 欄位\
 *  物件形式只填關心的欄位、其餘補預設（admin 預設 false、roles/ip 空）\
 *  例：分享上傳要 admin 權限但記名為連結建立者 `{ admin: true, user }`
 */
export type ServiceAs = Identity | Partial<Accountability>

/** items() / service 工廠的共用 opts\
 *  `trx` 只在「要綁的交易不是當前 scope 那個」時才需要（如把外部 trx 傳進無 scope 的 helper）——
 *  filter 事件的交易與 `transaction()` 開的都走 contextStore 自動生效
 */
export interface AccessOptions {
  as?: ServiceAs;
  trx?: Knex;
}

/** service 工廠：同步回傳 lazy proxy（方法呼叫時才建構底層 Directus service） */
export type ServiceFactory<T> = (opts?: AccessOptions) => T

type Cap<S extends string> = S extends `${infer H}${infer T}` ? `${Uppercase<H>}${T}` : S
type Pascal<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Cap<Head>}${Pascal<Tail>}`
  : Cap<S>
/** 例：'file_tags' → 'FileTagsService' */
export type ServiceKey<C extends string> = `${Pascal<C>}Service`

/** 系統集合的 Schema 型別常為部分擴充，故 payload/result 放寬 */
export interface ItemsServiceLike<Item = Record<string, any>> {
  createOne: (data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey>;
  createMany: (data: Partial<Item>[], opts?: WriteOptions) => Promise<PrimaryKey[]>;
  readOne: (key: PrimaryKey, query?: Query<Item>, opts?: ReadOptions) => Promise<any>;
  readMany: (keys: PrimaryKey[], query?: Query<Item>, opts?: ReadOptions) => Promise<any[]>;
  readByQuery: (query: Query<Item>, opts?: ReadOptions) => Promise<any[]>;
  readSingleton: (query: Query<Item>, opts?: ReadOptions) => Promise<any>;
  getKeysByQuery: (query: Query<Item>) => Promise<PrimaryKey[]>;
  updateOne: (key: PrimaryKey, data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey>;
  updateMany: (keys: PrimaryKey[], data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey[]>;
  updateByQuery: (query: Query<Item>, data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey[]>;
  updateBatch: (data: Partial<Item>[], opts?: WriteOptions) => Promise<PrimaryKey[]>;
  upsertOne: (data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey>;
  upsertMany: (data: Partial<Item>[], opts?: WriteOptions) => Promise<PrimaryKey[]>;
  upsertSingleton: (data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey>;
  deleteOne: (key: PrimaryKey, opts?: WriteOptions) => Promise<PrimaryKey>;
  deleteMany: (keys: PrimaryKey[], opts?: WriteOptions) => Promise<PrimaryKey[]>;
}

/** uploadOne / importOne 會實際寫入磁碟或 S3，不只是寫 directus_files 那列 */
export interface FilesService extends ItemsServiceLike {
  uploadOne: (stream: unknown, data: Record<string, unknown>, primaryKey?: PrimaryKey, opts?: unknown) => Promise<PrimaryKey>;
  importOne: (importURL: string, body: Record<string, unknown>) => Promise<PrimaryKey>;
}

export interface AssetsService {
  getAsset: (
    id: string,
    transformation?: unknown,
    range?: { start?: number; end?: number } | null,
  ) => Promise<{ stream: NodeJS.ReadableStream; file: Record<string, any>; stat?: { size: number } }>;
}

export interface MailService {
  send: (options: Record<string, unknown>) => Promise<unknown>;
}

export interface SpecialServiceTypes {
  AssetsService: AssetsService;
  FilesService: FilesService;
  MailService: MailService;
  UsersService: ItemsServiceLike;
  RolesService: ItemsServiceLike;
  FoldersService: ItemsServiceLike;
  PermissionsService: ItemsServiceLike;
  PoliciesService: ItemsServiceLike;
  SharesService: ItemsServiceLike;
  RevisionsService: ItemsServiceLike;
  ActivityService: ItemsServiceLike;
  SettingsService: ItemsServiceLike;
  NotificationsService: ItemsServiceLike;
  FlowsService: ItemsServiceLike;
  OperationsService: ItemsServiceLike;
  PresetsService: ItemsServiceLike;
  TranslationsService: ItemsServiceLike;
  CollectionsService: ItemsServiceLike;
  FieldsService: ItemsServiceLike;
  RelationsService: ItemsServiceLike;
  ExtensionsService: ItemsServiceLike;
}

export type ServiceFactories<S extends SchemaShape>
  = & { [C in keyof S & string as Exclude<ServiceKey<C>, keyof SpecialServiceTypes>]: ServiceFactory<TypedItemsService<S, C>> }
    & { [K in keyof SpecialServiceTypes]: ServiceFactory<SpecialServiceTypes[K]> }

// 名單與 SpecialServiceTypes 漏同步即編譯錯，故繞道 satisfies 而非直接寫字串 Set
const SPECIAL_SERVICE_NAME_MAP = {
  AssetsService: 1,
  FilesService: 1,
  MailService: 1,
  UsersService: 1,
  RolesService: 1,
  FoldersService: 1,
  PermissionsService: 1,
  PoliciesService: 1,
  SharesService: 1,
  RevisionsService: 1,
  ActivityService: 1,
  SettingsService: 1,
  NotificationsService: 1,
  FlowsService: 1,
  OperationsService: 1,
  PresetsService: 1,
  TranslationsService: 1,
  CollectionsService: 1,
  FieldsService: 1,
  RelationsService: 1,
  ExtensionsService: 1,
} satisfies Record<keyof SpecialServiceTypes, 1>

export const SPECIAL_SERVICE_NAMES: ReadonlySet<string> = new Set(Object.keys(SPECIAL_SERVICE_NAME_MAP))

/** 與型別層 Pascal 對齊：'file_tags' → 'FileTagsService' */
export function collectionToServiceKey(collection: string): string {
  const pascal = collection.split('_').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('')
  return `${pascal}Service`
}

/** Pascal 會吃掉底線，regex 無損反推不了（user_2fa 產生的 User2faService 只能反推成 user2fa）
 * 給了 schema 真實 collection 名時改用 forward Pascal 比對取回原名，否則退回 regex 盡力反推
 *
 * Pascal 非單射（`private` 與 `_private` 同產 `PrivateService`），比對到多張表時 throw：
 * 靜默取第一個會讓寫入落到哪張表由 `Object.keys` 順序決定，跨環境可能不同
 */
export function serviceKeyToCollection(key: string, knownCollections?: Iterable<string>): string {
  if (knownCollections) {
    const matches: string[] = []
    for (const collection of knownCollections) {
      if (collectionToServiceKey(collection) === key)
        matches.push(collection)
    }
    if (matches.length > 1) {
      throw new Error(
        `directus-typed-kit: service 工廠名 "${key}" 對應到多張表（${matches.join(', ')}），請改用 items(collection) 指名`,
      )
    }
    if (matches.length === 1)
      return matches[0]!
  }
  const base = key.endsWith('Service') ? key.slice(0, -'Service'.length) : key
  return base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
