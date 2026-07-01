// service 工廠集合的兩類 key：
//   1. 內建特化 service（FilesService / AssetsService…）→ runtime 用同名注入 class 建構、不帶 collection
//   2. 其餘 Schema collection → `${Pascal(C)}Service` 工廠 → runtime 走 ItemsService(C)
// 撞到保留名者（files / folders…）讓位給內建特化，該 collection 的 CRUD 改用 items(collection)
// 工廠同步回傳 lazy proxy（同 items()），方法呼叫時才建構底層 service

import type { Accountability, Identity } from '../core/types.js'
import type { PrimaryKey, Query, SchemaShape, TypedItemsService, WriteOptions } from './typed-items.js'

/** service 工廠 / items() 的執行身分：三種快捷字面量，或給部分 Accountability 欄位\
 *  物件形式只填關心的欄位、其餘補預設（admin 預設 false、roles/ip 空）\
 *  例：分享上傳要 admin 權限但記名為連結建立者 `{ admin: true, user }`
 */
export type ServiceAs = Identity | Partial<Accountability>

/** service 工廠：同步回傳 lazy proxy（方法呼叫時才建構底層 Directus service） */
export type ServiceFactory<T> = (opts?: { as?: ServiceAs }) => T

type Cap<S extends string> = S extends `${infer H}${infer T}` ? `${Uppercase<H>}${T}` : S
type Pascal<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Cap<Head>}${Pascal<Tail>}`
  : Cap<S>
/** collection 名 → service 工廠 key，例：'file_tags' → 'FileTagsService' */
export type ServiceKey<C extends string> = `${Pascal<C>}Service`

/** Directus ItemsService 家族通用方法\
 *  系統集合的 Schema 型別常為部分擴充，故 payload/result 放寬
 */
export interface ItemsServiceLike<Item = Record<string, any>> {
  createOne: (data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey>;
  createMany: (data: Partial<Item>[], opts?: WriteOptions) => Promise<PrimaryKey[]>;
  readOne: (key: PrimaryKey, query?: Query<Item>) => Promise<any>;
  readMany: (keys: PrimaryKey[], query?: Query<Item>) => Promise<any[]>;
  readByQuery: (query: Query<Item>) => Promise<any[]>;
  updateOne: (key: PrimaryKey, data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey>;
  updateMany: (keys: PrimaryKey[], data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey[]>;
  updateByQuery: (query: Query<Item>, data: Partial<Item>, opts?: WriteOptions) => Promise<PrimaryKey[]>;
  deleteOne: (key: PrimaryKey, opts?: WriteOptions) => Promise<PrimaryKey>;
  deleteMany: (keys: PrimaryKey[], opts?: WriteOptions) => Promise<PrimaryKey[]>;
}

/** Directus FilesService：ItemsService over directus_files + 二進位專屬方法（連磁碟 / S3 實體） */
export interface FilesService extends ItemsServiceLike {
  uploadOne: (stream: unknown, data: Record<string, unknown>, primaryKey?: PrimaryKey, opts?: unknown) => Promise<PrimaryKey>;
  importOne: (importURL: string, body: Record<string, unknown>) => Promise<PrimaryKey>;
}

/** Directus AssetsService：串流 / 轉檔取得 binary */
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

/** 保留的內建特化 service 名稱 → 型別\
 *  撞到這些名稱的 collection 一律讓位給內建，業務 CRUD 改用 items(collection)
 */
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
  WebhooksService: ItemsServiceLike;
  CollectionsService: ItemsServiceLike;
  FieldsService: ItemsServiceLike;
  RelationsService: ItemsServiceLike;
  ExtensionsService: ItemsServiceLike;
}

/** kit 由 Schema 產生的 service 工廠集合（tools.services 的型別），值皆為 ServiceFactory\
 *  內建保留名給特化型別，其餘 collection 自動產生（TypedItemsService）
 */
export type ServiceFactories<S extends SchemaShape>
  = & { [C in keyof S & string as Exclude<ServiceKey<C>, keyof SpecialServiceTypes>]: ServiceFactory<TypedItemsService<S, C>> }
    & { [K in keyof SpecialServiceTypes]: ServiceFactory<SpecialServiceTypes[K]> }

// satisfies Record<keyof SpecialServiceTypes, 1>：漏一個或多一個名稱即編譯錯，強制與型別同步
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
  WebhooksService: 1,
  CollectionsService: 1,
  FieldsService: 1,
  RelationsService: 1,
  ExtensionsService: 1,
} satisfies Record<keyof SpecialServiceTypes, 1>

export const SPECIAL_SERVICE_NAMES: ReadonlySet<string> = new Set(Object.keys(SPECIAL_SERVICE_NAME_MAP))

/** collection 名 → 工廠 key 的 runtime 版，與型別層 Pascal 對齊且無損：'file_tags' → 'FileTagsService' */
export function collectionToServiceKey(collection: string): string {
  const pascal = collection.split('_').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('')
  return `${pascal}Service`
}

/** service 工廠 key 反推 collection 名，例：'FileTagsService' 得 'file_tags'
 * Pascal 會吃掉底線，regex 無損反推不了（user_2fa 產生的 User2faService 只能反推成 user2fa）
 * 給了 schema 真實 collection 名時改用 forward Pascal 比對取回原名，否則退回 regex 盡力反推
 */
export function serviceKeyToCollection(key: string, knownCollections?: Iterable<string>): string {
  if (knownCollections) {
    for (const collection of knownCollections) {
      if (collectionToServiceKey(collection) === key)
        return collection
    }
  }
  const base = key.endsWith('Service') ? key.slice(0, -'Service'.length) : key
  return base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
