// endpoint domain 型別：route / guard / 回傳語義 / EndpointTools

import type { Accountability, Logger } from '../core/types.js'
import type { SchemaShape } from '../data-access/typed-items.js'
import type { DataAccess } from '../data-access/types.js'
import type { InferOutput, StandardSchemaV1 } from '../schema/standard-schema.js'
import type { Request, Response, Router } from 'express'

export type RawResponse = typeof import('./schema-guards.js').RAW

/** reply() 的回傳 sentinel；wrapper 偵測後以指定狀態碼回應 */
export interface Reply {
  status: number;
  body?: unknown;
}

export type RouteResult = unknown | RawResponse

export interface RouteContext {
  req: Request;
  res: Response;
  params: Record<string, string>;
  query: Record<string, unknown>;
  /** 經 body() guard 後在 handler 收斂為 typed */
  body: unknown;
  accountability: Accountability | null;
}

/** route guard：擋下用 throw、要帶欄位進 ctx 才回物件（型別累加到 handler ctx）、其餘不回傳（void） */
export type Guard<Extra extends object = Record<never, never>> = (ctx: RouteContext) => Extra | void | Promise<Extra | void>

export type MergeExtras<G extends readonly Guard[]> = G extends readonly [Guard<infer E>, ...infer Rest]
  ? E & (Rest extends readonly Guard[] ? MergeExtras<Rest> : Record<never, never>)
  : Record<never, never>

export interface RouteOptions<G extends readonly Guard[]> {
  guards?: G;
  response?: StandardSchemaV1;
}

export interface Route {
  <const G extends readonly Guard[]>(
    path: string,
    options: RouteOptions<G>,
    handler: (ctx: RouteContext & MergeExtras<G>) => RouteResult | Promise<RouteResult>,
  ): void;
  (path: string, handler: (ctx: RouteContext) => RouteResult | Promise<RouteResult>): void;
}

export interface EndpointTools<S extends SchemaShape> extends DataAccess<S> {
  route: { get: Route; post: Route; put: Route; patch: Route; delete: Route };
  router: Router;
  logger: Logger;
  accountability: (req: Request) => Accountability | null;
}

// guard schema 推導輔助（schema-guards 用，internal）
export type SchemaGuardOutput<Sc> = InferOutput<Sc>
