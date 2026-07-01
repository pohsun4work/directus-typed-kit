// directus-typed-kit/endpoint 入口：createEndpoint 工廠 + endpoint 專屬 runtime（body/query/params、reply、RAW）與型別
// 與 hook 入口拆開，讓只寫 endpoint 的 extension entry 不牽連 hook 的 runtime 圖（treeshake）

import { defineEndpoint } from '@directus/extensions-sdk'

import { buildEndpointTools } from './build.js'

import type { RegisteredSchema, SchemaShape } from '../data-access/typed-items.js'
import type { EndpointTools } from './types.js'

// S 預設取 KitSchema 註冊值：消費端註冊一次即免逐次帶泛型，仍可 createEndpoint<別的Schema>(...) 覆寫
export function createEndpoint<S extends SchemaShape = RegisteredSchema>(register: (tools: EndpointTools<S>) => void): unknown {
  return defineEndpoint((router, context) => {
    register(buildEndpointTools<S>(router as never, context as never))
  })
}

export { body, params, query, RAW, reply } from './schema-guards.js'
// Route / RouteContext / RouteOptions / RouteResult 為內部型別（呼叫/inline 即可，不具名）
export type {
  EndpointTools,
  Guard,
  Reply,
} from './types.js'
