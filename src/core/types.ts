// 跨 domain 共用的基礎型別：執行身分、logger、schema 佔位
// hook / endpoint / service 都建在這幾個之上

// 直接取 Directus 框架型別當單一來源，隨 @directus/types 版本同步
export type { Accountability } from '@directus/types'

/** - 'caller'（預設）→ 呼叫者真實 accountability，照 Directus ACL（安全預設）
 *  - 'admin'          → { admin: true }，繞過 ACL、記名
 *  - 'system'         → null，繞過 ACL、不記名
 */
export type Identity = 'admin' | 'system' | 'caller'

/** runtime metadata，row 型別來自 Schema[C]，此處佔位（由 data-access 在邊界 cast） */
export type SchemaOverview = unknown

/** 宿主（Directus / pino）注入的 logger\
 *  沿用 pino 的 `(obj, msg)` 與 `(msg)` 兩種呼叫形式
 */
export interface LogFn {
  (obj: unknown, msg?: string): void;
  (msg: string): void;
}
export interface Logger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
}
