// 系統 collection（directus_*）名 → SDK 完整 row 型別的對照表
// ts-typegen 對系統表只 emit 自訂欄位，核心 / 隱藏欄位皆缺，故在此用 SDK 型別補齊（SDK 型別仍只經適配器）
// 日期 / conceal 由 BrandSystemField branding，core 兩視角再據 brand 分流

import type { Concealed } from '../../schema/conceal.js'
import type { ConcealedOf } from '../conceal-fields.js'
import type { MapField } from './brand.js'
import type {
  DirectusAccess,
  DirectusActivity,
  DirectusComment,
  DirectusDashboard,
  DirectusFile,
  DirectusFlow,
  DirectusFolder,
  DirectusNotification,
  DirectusOperation,
  DirectusPanel,
  DirectusPermission,
  DirectusPolicy,
  DirectusPreset,
  DirectusRevision,
  DirectusRole,
  DirectusShare,
  DirectusTranslation,
  DirectusUser,
  DirectusVersion,
  DirectusWebhook,
} from '@directus/sdk'

// 系統 collection 名 → SDK 完整 row 型別
// 皆 `MergeCoreCollection<S, ...>`，把使用者 Schema 同名 collection 的自訂欄位一併併入
// SDK 型別的日期同樣是 "datetime" 字面量，交給 BrandSystemRow 統一 brand
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
}

/** 合法的系統 collection 名（與 SystemTypeMap 的 key 一致） */
export type SystemCollectionName = keyof SystemTypeMap<unknown> & string

// 單一系統欄位 branding：
//   - conceal 欄位 → Concealed brand（保留 | null）；core 兩視角據此分流（service 排除、knex 還原 string）
//   - 其餘 → 日期 "datetime" 字面量轉 Timestamp brand（非日期原樣穿透、關聯保留 string | Row）
type BrandSystemField<T, Conceal, K>
  = K extends Conceal ? Concealed | Extract<T, null> : MapField<T, 'timestamp'>

/** 系統表完整 row 的 branded 版：核心欄位全包、日期 brand、conceal brand —— 供 FromTsTypegen 灌進 Schema */
export type BrandSystemRow<S, C extends SystemCollectionName>
  = { [K in keyof SystemTypeMap<S>[C]]: BrandSystemField<SystemTypeMap<S>[C][K], ConcealedOf<C>, K> }
