// directus-typed-kit/hook 入口：createHook 工廠 + hook 專屬 runtime（validate / definePermission）與型別
// 與 endpoint 入口拆開，讓只寫 hook 的 extension entry 不牽連 endpoint 的 runtime 圖（treeshake）
// runtime 100% 沿用原生 defineHook，只在 register callback 內把 tools 組好交給使用者

import { defineHook } from '@directus/extensions-sdk'

import { buildHookTools } from './build.js'

import type { RegisteredSchema, SchemaShape } from '../data-access/typed-items.js'
import type { HookTools } from './types.js'

/** S 預設取 KitSchema 註冊值：消費端註冊一次即免逐次帶泛型，仍可 createHook<別的Schema>(...) 覆寫 */
export function createHook<S extends SchemaShape = RegisteredSchema>(register: (tools: HookTools<S>) => void): unknown {
  return defineHook((events, context) => {
    register(buildHookTools<S>(events as never, context as never))
  })
}

export { definePermission, validate } from './middleware.js'
// EventMeta / ActionMeta / EventContext（經 handler 型別帶出）、PermissionCheck / InitEvent 為內部型別，不對外
export type {
  ActionHandler,
  DeleteHandler,
  FilterHandler,
  FilterMiddleware,
  HookTools,
} from './types.js'
