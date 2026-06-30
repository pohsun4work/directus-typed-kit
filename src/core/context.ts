// items()/service() 在註冊期就解構（closure 綁定一次），但 as:'caller' 需要本次事件 / 請求的真實 accountability
// 用 AsyncLocalStorage 帶 per-event scope（accountability + schema）：hook / endpoint 包裝層各 run 一個 scope，
// items({ as:'caller' }) 在方法呼叫時讀回；無 scope（如 schedule）時 fallback 為 null（system）

import { AsyncLocalStorage } from 'node:async_hooks'

import type { Accountability, SchemaOverview } from './types.js'

export interface KitContextScope {
  accountability: Accountability | null;
  /** hook event context 已帶 schema\
   *  endpoint 無，items() 會改 await getSchema()
   */
  schema?: SchemaOverview;
}

export const contextStore = new AsyncLocalStorage<KitContextScope>()
