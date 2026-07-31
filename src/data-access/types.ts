import type { Accountability, SchemaOverview } from '../core/types.js'
import type { KnexView } from '../schema/dates.js'
import type { AccessOptions, ServiceFactories } from './directus-services.js'
import type { CollectionItem, SchemaShape, TypedItemsService } from './typed-items.js'
import type { Knex } from 'knex'

type Collection<S extends SchemaShape> = keyof S & string

/** 覆寫某張表的 knex row 型別，給不在 Schema 的表（自訂 raw 表、要 typed 的 `directus_*`）用
 *  ```
 *  declare module 'directus-typed-kit' {
 *    interface KnexOverrides { my_raw_table: { id: string, payload: unknown } }
 *  }
 *  ```
 */
export interface KnexOverrides {}

type KnexTableName<S> = (keyof S | keyof KnexOverrides) & string

/** `& {}` 滿足 Knex.QueryBuilder<TRecord extends {}> 約束（row 恆為物件，交集不改型別） */
type KnexRow<S, C extends KnexTableName<S>>
  = (C extends keyof KnexOverrides
    ? KnexOverrides[C]
    : C extends keyof S ? KnexView<CollectionItem<S, C & keyof S>> : never) & {}

type SchemaTable<S> = <C extends KnexTableName<S>>(tableName: C) => Knex.QueryBuilder<KnexRow<S, C>, KnexRow<S, C>[]>

/** Schema-aware 簽章插在 Knex 既有 callable 之前（intersection＝overload 集合、前者優先），\
 *  `knex('files')` 即 typed、免消費端 augment 全域 knex/types/tables
 */
export type SchemaKnex<S> = SchemaTable<S> & Knex

/** 原生 `knex.transaction` 回的 `Knex.Transaction` 沒有 Schema-aware 那條 overload，\
 *  交易體整條查詢鏈會塌成 any
 */
export type SchemaTrx<S> = SchemaTable<S> & Knex.Transaction

export type ServiceCtor<T> = new (options: {
  schema: SchemaOverview;
  accountability: Accountability | null;
  knex: Knex;
}) => T

export interface GetSchemaOptions {
  database?: Knex;
  bypassCache?: boolean;
}

export interface DataAccess<S extends SchemaShape> {
  /** 同步回傳，schema 在方法呼叫時才 lazy 取（不 stale） */
  items: <C extends Collection<S>>(collection: C, opts?: AccessOptions) => TypedItemsService<S, C>;
  /** 撞到 Directus 內建 service 保留名的 collection（files / folders…）讓位給內建，\
   *  其 CRUD 改用 items('files') / items('folders')
   */
  services: ServiceFactories<S>;
  /** typed 工廠涵蓋不到的 service（如自帶第三方 service）才走這裡 */
  service: <T>(ctor: ServiceCtor<T>, opts?: AccessOptions) => Promise<T>;
  knex: SchemaKnex<S>;
  /** 交易內的 items() / services / knex 存取自動落在同一 trx，巢狀呼叫即開 savepoint\
   *  fn 正常結束即 commit、throw 即 rollback
   */
  transaction: <T>(fn: (trx: SchemaTrx<S>) => Promise<T>) => Promise<T>;
  /** 交易內做過 DDL 後要讓後續讀取看到新表，須自行帶 `{ database: trx, bypassCache: true }` 重取\
   *  —— items() / services 只在當前 scope 尚未有 schema 時才會重新解析
   */
  getSchema: (options?: GetSchemaOptions) => Promise<SchemaOverview>;
}
