import type { Accountability, SchemaOverview } from '../core/types.js'
import type { KnexView } from '../schema/dates.js'
import type { ServiceAs, ServiceFactories } from './directus-services.js'
import type { CollectionItem, SchemaShape, TypedItemsService } from './typed-items.js'
import type { Knex } from 'knex'

type Collection<S extends SchemaShape> = keyof S & string

/** 消費端覆寫某張表的 knex row 型別（module augmentation）\
 *  給「不在 Schema 的自訂 raw 表」用 —— 系統表由 generator 適配器灌進 Schema，走一般路徑即 typed
 *  ```
 *  declare module 'directus-typed-kit' {
 *    interface KnexOverrides { my_raw_table: { id: string, payload: unknown } }
 *  }
 *  ```
 */
export interface KnexOverrides {}

type KnexTableName<S> = (keyof S | keyof KnexOverrides) & string

/** 表名 → knex row：override 優先，否則 Schema 投影成 knex 視角（KnexView 內含 conceal→string、多數日期→Date 但 time 回 string、o2m 欄位移除）\
 *  `& {}` 滿足 Knex.QueryBuilder<TRecord extends {}> 約束（row 恆為物件，交集不改型別）
 */
type KnexRow<S, C extends KnexTableName<S>>
  = (C extends keyof KnexOverrides
    ? KnexOverrides[C]
    : C extends keyof S ? KnexView<CollectionItem<S, C & keyof S>> : never) & {}

/** Schema 綁定的 knex：在 Knex 既有 callable 簽章前插入 Schema-aware 簽章\
 *  （intersection＝overload 集合、前者優先）→ `knex('files')` 直接 typed，免消費端 augment\
 *  全域 knex/types/tables，raw / transaction / schema 等其餘介面原樣保留
 */
export type SchemaKnex<S>
  = & (<C extends KnexTableName<S>>(tableName: C) => Knex.QueryBuilder<KnexRow<S, C>, KnexRow<S, C>[]>)
    & Knex

export type ServiceCtor<T> = new (options: {
  schema: SchemaOverview;
  accountability: Accountability | null;
  knex: Knex;
}) => T

export interface DataAccess<S extends SchemaShape> {
  /** 某 collection 的 ItemsService —— 完整 typed（read* 依 fields 推結果，含巢狀關聯）\
   *  身分用 as 指定（預設 caller），同步回傳，schema 在方法呼叫時 lazy 取
   */
  items: <C extends Collection<S>>(collection: C, opts?: { as?: ServiceAs }) => TypedItemsService<S, C>;
  /** 由 Schema 自動產生的 typed service 工廠集合：
   *  - `services.FileTagsService({ as })` → TypedItemsService<S, 'file_tags'>（任意 collection）
   *  - `services.FilesService({ as })` / `services.AssetsService` / `services.UsersService`… → Directus 內建特化 service
   *
   *  業務 files / folders 名稱讓位給內建特化 service，其 CRUD 改用 items('files') / items('folders')
   */
  services: ServiceFactories<S>;
  /** typed 工廠涵蓋不到的 service（如自帶第三方 service）才走這裡，以任意 ctor class 建構、身分同 as */
  service: <T>(ctor: ServiceCtor<T>, opts?: { as?: ServiceAs }) => Promise<T>;
  /** Schema 綁定的 raw knex：已知表名（Schema collection / KnexOverrides 登錄表）回 typed QueryBuilder */
  knex: SchemaKnex<S>;
  getSchema: () => Promise<SchemaOverview>;
}
