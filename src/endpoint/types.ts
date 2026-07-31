import type { Accountability, Logger } from '../core/types.js'
import type { RegisteredSchema, SchemaShape } from '../data-access/typed-items.js'
import type { DataAccess } from '../data-access/types.js'
import type { InferOutput, StandardSchemaV1 } from '../schema/standard-schema.js'
import type { Request, Response, Router } from 'express'

/** reply() 的回傳 sentinel，帶私有 REPLY brand 使手寫 { status, body } 無法冒充\
 *  `B` 讓 response schema 連帶檢查 reply 的 body（省略 body 時為 undefined、對任何 schema 都放行）
 */
export type Reply<B = unknown> = {
  status: number;
  body?: B;
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

type RequestFields = Pick<RouteContext<SchemaShape>, 'body' | 'query' | 'params'>

/** ctx 參數只吃請求欄位、不碰 DataAccess：綁 `RouteContext<S>` 會被 S 逆變釘死在註冊的 Schema 上，\
 *  `createEndpoint<別的Schema>` 一用即不 assignable
 */
export type RequestGuard<Extra extends object> = (ctx: RequestFields) => Promise<Extra>

type ExtraOf<R> = [Exclude<Awaited<R>, void | undefined>] extends [never]
  ? Record<never, never>
  : Exclude<Awaited<R>, void | undefined>

// 由回傳型別 infer，不比對 Guard：後者的 ctx 參數逆變，一顆 guard 綁在別的 S 上就整串塌成
// Record<never, never>，同陣列其他 guard 的 extras 也跟著消失
export type MergeExtras<G extends readonly unknown[]>
  = G extends readonly [infer H, ...infer Rest]
    ? (H extends (...args: never[]) => infer R ? ExtraOf<R> : Record<never, never>) & MergeExtras<Rest>
    : Record<never, never>

export interface RouteOptions<G extends readonly unknown[], R extends StandardSchemaV1 = never> {
  guards?: G;
  response?: R;
}

/** 給了 response schema 就把 handler 回傳釘在它的 output 上，否則宣告與實作在同一個呼叫裡卻只在 runtime 撞 500\
 *  RAW 例外：handler 自行寫 res，wrapper 既不驗證也不序列化
 *
 * RAW 那支寫寬 `symbol` 而非 `typeof RAW`：Route 是多載介面，`() => RAW` 在多載解析下\
 * 會先被推成 `() => symbol`，釘死 unique symbol 反而讓正常寫法編譯不過
 */
type RouteReturn<R>
  = [R] extends [never]
    ? RouteResult
    : InferOutput<R> | Reply<InferOutput<R>> | symbol

export interface Route<S extends SchemaShape = RegisteredSchema> {
  <const G extends readonly Guard<object, S>[], R extends StandardSchemaV1 = never>(
    path: string,
    options: RouteOptions<G, R>,
    handler: (ctx: RouteContext<S> & MergeExtras<G>) => RouteReturn<R> | Promise<RouteReturn<R>>,
  ): void;
  (path: string, handler: (ctx: RouteContext<S>) => RouteResult | Promise<RouteResult>): void;
}

export interface EndpointTools<S extends SchemaShape> extends DataAccess<S> {
  route: { get: Route<S>; post: Route<S>; put: Route<S>; patch: Route<S>; delete: Route<S> };
  router: Router;
  logger: Logger;
  accountability: (req: Request) => Accountability | null;
}

export type SchemaGuardOutput<Sc> = InferOutput<Sc>
