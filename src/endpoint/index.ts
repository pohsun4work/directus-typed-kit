// endpoint 入口，與 hook 入口拆開讓只寫 endpoint 的 extension entry 不牽連 hook 的 runtime 圖（treeshake）

import { defineEndpoint } from '@directus/extensions-sdk'

import { buildEndpointTools } from './build.js'

import type { RegisteredSchema, SchemaShape } from '../data-access/typed-items.js'
import type { EndpointTools } from './types.js'

/** S 預設取 KitSchema 註冊值，仍可 createEndpoint<別的Schema>(...) 覆寫 */
export function createEndpoint<S extends SchemaShape = RegisteredSchema>(register: (tools: EndpointTools<S>) => void): unknown {
  return defineEndpoint((router, context) => {
    register(buildEndpointTools<S>(router as never, context as never))
  })
}

export { body, params, query, RAW, reply } from './schema-guards.js'
export type {
  EndpointTools,
  Guard,
  Reply,
  RequestGuard,
  RouteContext,
} from './types.js'
