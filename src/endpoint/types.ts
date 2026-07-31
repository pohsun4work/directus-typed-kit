import type { Accountability, Logger } from '../core/types.js'
import type { RegisteredSchema, SchemaShape } from '../data-access/typed-items.js'
import type { DataAccess } from '../data-access/types.js'
import type { InferOutput, StandardSchemaV1 } from '../schema/standard-schema.js'
import type { Request, Response, Router } from 'express'

/** reply() 的回傳 sentinel，帶私有 REPLY brand 使手寫 { status, body } 無法冒充 */
export type Reply = {
  status: number;
  body?: unknown;
} & Record<typeof import('./schema-guards.js').REPLY, true>

/** unknown 已吸收一切（含 RAW sentinel），單獨列聯集只是誤導 */
export type RouteResult = unknown

/** guard 寫在外部模組、拿不到 createEndpoint 閉包裡的 tools，故 ctx 自帶 DataAccess\
 *  否則「查參與者」「驗擁有權」這類資料型授權只能降級成 handler 內 helper、逐支端點重抄
 */
export interface RouteContext<S extends SchemaShape = RegisteredSchema> extends DataAccess<S> {
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: Record<string, unknown>;
  /** 經 body() guard 後在 handler 收斂為 typed */
  body: unknown;
  accountability: Accountability | null;
}

/** route guard：擋下用 throw、要帶欄位進 ctx 才回物件（型別累加到 handler ctx）、其餘不回傳（void） */
export type Guard<Extra extends object = Record<never, never>, S extends SchemaShape = RegisteredSchema>
  = (ctx: RouteContext<S>) => Extra | void | Promise<Extra | void>

/** ctx 上與 Schema 無關的請求欄位 */
type RequestFields = Pick<RouteContext<SchemaShape>, 'body' | 'query' | 'params'>

/** 內建 guard（body / query / params）：ctx 參數只吃請求欄位，不碰 DataAccess\
 *  綁 `RouteContext<S>` 的話會被 S 逆變釘死在註冊的 Schema 上，`createEndpoint<別的Schema>` 一用即不 assignable
 */
export type RequestGuard<Extra extends object> = (ctx: RequestFields) => Promise<Extra>

/** guard 回傳的 extras，`void` 與條件式不回傳的分支不貢獻欄位 */
type ExtraOf<R> = [Exclude<Awaited<R>, void | undefined>] extends [never]
  ? Record<never, never>
  : Exclude<Awaited<R>, void | undefined>

// 由回傳型別 infer，不比對 Guard：後者的 ctx 參數逆變，一顆 guard 綁在別的 S 上就整串塌成
// Record<never, never>，同陣列其他 guard 的 extras 也跟著消失
export type MergeExtras<G extends readonly unknown[]>
  = G extends readonly [infer H, ...infer Rest]
    ? (H extends (...args: never[]) => infer R ? ExtraOf<R> : Record<never, never>) & MergeExtras<Rest>
    : Record<never, never>

export interface RouteOptions<G extends readonly unknown[]> {
  guards?: G;
  response?: StandardSchemaV1;
}

export interface Route<S extends SchemaShape = RegisteredSchema> {
  <const G extends readonly Guard<object, S>[]>(
    path: string,
    options: RouteOptions<G>,
    handler: (ctx: RouteContext<S> & MergeExtras<G>) => RouteResult | Promise<RouteResult>,
  ): void;
  (path: string, handler: (ctx: RouteContext<S>) => RouteResult | Promise<RouteResult>): void;
}

export interface EndpointTools<S extends SchemaShape> extends DataAccess<S> {
  route: { get: Route<S>; post: Route<S>; put: Route<S>; patch: Route<S>; delete: Route<S> };
  router: Router;
  logger: Logger;
  accountability: (req: Request) => Accountability | null;
}

/** guard schema 推導輔助，internal */
export type SchemaGuardOutput<Sc> = InferOutput<Sc>
