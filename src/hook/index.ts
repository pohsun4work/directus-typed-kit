// 與 endpoint 入口拆開，讓只寫 hook 的 extension entry 不牽連 endpoint 的 runtime 圖（treeshake）

import { defineHook } from '@directus/extensions-sdk'

import { buildHookTools } from './build.js'

import type { RegisteredSchema, SchemaShape } from '../data-access/typed-items.js'
import type { HookTools } from './types.js'

/** S 預設取 KitSchema 註冊值，仍可 createHook<別的Schema>(...) 覆寫 */
export function createHook<S extends SchemaShape = RegisteredSchema>(register: (tools: HookTools<S>) => void): unknown {
  return defineHook((events, context) => {
    register(buildHookTools<S>(events as never, context as never))
  })
}

export { definePermission, validate } from './middleware.js'
export type {
  ActionHandler,
  ActionMeta,
  DeleteHandler,
  EventContext,
  EventMeta,
  FilterContext,
  FilterHandler,
  FilterMiddleware,
  GateMiddleware,
  HookTools,
  InitEvent,
  InitMetaMap,
  MiddlewareHandler,
  PermissionCheck,
} from './types.js'
