// ts-typegen 對系統表只 emit 自訂欄位，核心 / 隱藏欄位皆缺，故在此用 SDK 型別補齊
// 日期 / conceal 由 BrandSystemField branding，core 兩視角再據 brand 分流

import type { Concealed } from '../../schema/conceal.js'
import type { BrandMap, TemporalKind } from '../../schema/dates.js'
import type { ConcealedOf } from '../conceal-fields.js'
import type { MapField } from './brand.js'
import type {
  DirectusAccess,
  DirectusActivity,
  DirectusCollection,
  DirectusComment,
  DirectusDashboard,
  DirectusExtension,
  DirectusField,
  DirectusFile,
  DirectusFlow,
  DirectusFolder,
  DirectusNotification,
  DirectusOperation,
  DirectusPanel,
  DirectusPermission,
  DirectusPolicy,
  DirectusPreset,
  DirectusRelation,
  DirectusRevision,
  DirectusRole,
  DirectusSettings,
  DirectusShare,
  DirectusTranslation,
  DirectusUser,
  DirectusVersion,
  DirectusWebhook,
} from '@directus/sdk'

/** 系統 collection（directus_*）名 → SDK 完整 row 型別的對照表
 *  日期同樣是 "datetime" 字面量，交給 BrandSystemRow 統一 brand
 */
export interface SystemTypeMap<S> {
  directus_users: DirectusUser<S>;
  directus_files: DirectusFile<S>;
  directus_folders: DirectusFolder<S>;
  directus_roles: DirectusRole<S>;
  directus_policies: DirectusPolicy<S>;
  directus_permissions: DirectusPermission<S>;
  directus_access: DirectusAccess<S>;
  directus_presets: DirectusPreset<S>;
  directus_shares: DirectusShare<S>;
  directus_activity: DirectusActivity<S>;
  directus_revisions: DirectusRevision<S>;
  directus_notifications: DirectusNotification<S>;
  directus_comments: DirectusComment<S>;
  directus_versions: DirectusVersion<S>;
  directus_flows: DirectusFlow<S>;
  directus_operations: DirectusOperation<S>;
  directus_dashboards: DirectusDashboard<S>;
  directus_panels: DirectusPanel<S>;
  directus_translations: DirectusTranslation<S>;
  directus_webhooks: DirectusWebhook<S>;
  directus_settings: DirectusSettings<S>;
  directus_collections: DirectusCollection<S>;
  directus_fields: DirectusField<S>;
  directus_relations: DirectusRelation<S>;
  directus_extensions: DirectusExtension<S>;
}

export type SystemCollectionName = keyof SystemTypeMap<unknown> & string

/** 單一系統欄位 branding，優先序：
 *  1. Override 指定 → TemporalKind 字面量標 date brand，否則當明確型別逐字採用
 *  2. conceal 欄位 → Concealed brand（保留 | null）
 *  3. 其餘 → 日期 "datetime" 字面量標 Timestamp brand（非日期原樣穿透、關聯保留 string | Row）
 */
type BrandSystemField<T, Conceal, Override, K>
  = K extends keyof Override
    ? (Override[K] extends TemporalKind ? BrandMap[Override[K]] | Extract<T, null> : Override[K])
    : K extends Conceal
      ? Concealed | Extract<T, null>
      : MapField<T, 'timestamp'>

/** 系統表完整 row 的 branded 版：核心欄位全包、日期 brand、conceal brand、套 Override —— 供 FromTsTypegen 灌進 Schema
 * `-?` + Exclude undefined 正規化 optional 欄位（讀取結果欄位恆在、值可能 null），與 generate-types 適配器一致
 */
export type BrandSystemRow<S, C extends SystemCollectionName, Override>
  = { [K in keyof SystemTypeMap<S>[C]]-?: Exclude<BrandSystemField<SystemTypeMap<S>[C][K], ConcealedOf<C>, Override, K>, undefined> }
