// 由 Schema 自動產生的 typed service 工廠集合，兩類 key：
//   1. 內建特化 service（FilesService / AssetsService / UsersService…）→ runtime 用同名注入 class 建構（不帶 collection）
//   2. 其餘 Schema collection → `${Pascal(C)}Service` 工廠 → runtime 走 ItemsService(C)、型別 TypedItemsService<S, C>
// 名稱撞到保留名者（files / folders…）讓位給內建特化，該 collection 的 CRUD 改用 items(collection)
//
// 工廠同步回傳 lazy proxy（同 items()）：`const x = services.FileTagsService({ as })` 再 `await x.createOne(...)`

import type { Accountability, Identity } from '../core/types.js'
import type { PrimaryKey, Query, SchemaShape, TypedItemsService, WriteOptions } from './typed-items.js'

/** service 工廠 / items() 的執行身分：三種快捷字面量，或給部分 Accountability 欄位\
 *  物件形式只需填關心的欄位、其餘由 kit 補預設（admin 預設 false、roles/ip 空）\
 *  （例如分享上傳要 admin 權限但記名為連結建立者：{ admin: true, user }）
 */
export type ServiceAs = Identity | Partial<Accountability>

/** service 工廠：同步回傳 lazy proxy（方法呼叫時才建構底層 Directus service） */
export type ServiceFactory<T> = (opts?: { as?: ServiceAs }) => T

// snake_case → PascalCase（type-level）
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
 *  runtime 用真實注入 class 建構（不帶 collection 參數）\
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

/** kit 由 Schema 產生的 service 工廠集合（tools.services 的型別）：值皆為 ServiceFactory；\
 *  內建保留名給特化型別，其餘 collection 自動產生（TypedItemsService）
 */
export type ServiceFactories<S extends SchemaShape>
  = & { [C in keyof S & string as Exclude<ServiceKey<C>, keyof SpecialServiceTypes>]: ServiceFactory<TypedItemsService<S, C>> }
    & { [K in keyof SpecialServiceTypes]: ServiceFactory<SpecialServiceTypes[K]> }

/** 保留名集合（runtime 判斷用，須與 SpecialServiceTypes 的 key 一致） */
export const SPECIAL_SERVICE_NAMES: ReadonlySet<string> = new Set([
  'AssetsService',
  'FilesService',
  'MailService',
  'UsersService',
  'RolesService',
  'FoldersService',
  'PermissionsService',
  'PoliciesService',
  'SharesService',
  'RevisionsService',
  'ActivityService',
  'SettingsService',
  'NotificationsService',
  'FlowsService',
  'OperationsService',
  'PresetsService',
  'TranslationsService',
  'WebhooksService',
  'CollectionsService',
  'FieldsService',
  'RelationsService',
  'ExtensionsService',
])

/** service 工廠 key → collection 名，例：'FileTagsService' → 'file_tags' */
export function serviceKeyToCollection(key: string): string {
  const base = key.endsWith('Service') ? key.slice(0, -'Service'.length) : key
  return base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
