// directus-extension-ts-typegen 產出 → kit 結構 contract 的型別適配器（純型別、零 runtime）
// 主檔做「版本 → 版本檔」對應、灌系統表、並 re-export 系統型別；版本檔 v*.ts 是各輸出結構世代的轉換
//
// 同時是 ts-typegen 產出的「相依出口」：把產出檔的 `import ... from "@directus/sdk"` 改指本適配器，
// 即可拿掉消費端 tsconfig alias、免裝 @directus/sdk（產出檔所在套件本就相依 directus-kit）
// 系統型別只在 @directus/sdk（@directus/types 沒有），在此 re-export；dts bundler 會 inline 進產物（dist 不殘留 sdk import）

import type { BrandSystemRow, SystemCollectionName } from './system.js'
import type { Transform as V0_6_0 } from './v0.6.0.js'

// 把系統 collection（directus_*）灌進 Schema：ts-typegen 對系統表只 emit 自訂欄位
// 這裡用 SDK 完整型別（branded：日期→brand、conceal→brand）覆蓋／補上
// core 走一般 Schema 路徑即可 typed 系統表，毋須 core 認得 SDK／系統表（generator 無關）
// M = 已過日期 brand 的 schema（自訂 collection 那側）
type ApplySystemTables<M> = Omit<M, SystemCollectionName> & {
  [C in SystemCollectionName]: BrandSystemRow<M, C>[]
}

export type {
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

// 支援版本清單；採用新版時把版本字串加進聯集，不指定則用 Latest
type TsTypegenVersion = '0.6.0'
type Latest = '0.6.0'

/** 版本 → 版本檔；結構相同的版本共用一檔，結構變了才新增 v<新版>.ts 並在此加分支 */
type StructureOf<V extends TsTypegenVersion, S, O> = V extends '0.6.0' ? V0_6_0<S, O> : never

/** ts-typegen 產出 Schema → kit 形狀。第二參數填「版本」或直接填「Overrides」（省略版本＝Latest）
 *  - `FromTsTypegen<Schema>` / `<Schema, Overrides>` / `<Schema, '0.6.0'>` / `<Schema, '0.6.0', Overrides>`
 *
 *  先過版本結構轉換（日期 brand），再灌入系統 collection 的 SDK 完整型別，故 items() / knex 對系統表開箱即 typed
 */
export type FromTsTypegen<
  S,
  VersionOrOverrides extends TsTypegenVersion | { [C in keyof S]?: Record<string, unknown> } = Latest,
  Overrides = Record<never, never>
> = VersionOrOverrides extends TsTypegenVersion
  ? ApplySystemTables<StructureOf<VersionOrOverrides, S, Overrides>>
  : ApplySystemTables<StructureOf<Latest, S, VersionOrOverrides>>
