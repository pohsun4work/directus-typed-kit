// items()/service() 註冊期就解構（closure 綁定一次），但 as:'caller' 需要本次事件/請求的真實 accountability
// 故用 AsyncLocalStorage 帶 per-event scope

import { AsyncLocalStorage } from 'node:async_hooks'

import type { Accountability, SchemaOverview } from './types.js'
import type { Knex } from 'knex'

export interface KitContextScope {
  accountability: Accountability | null;
  /** hook event context 已帶 schema，endpoint 無時 items() 會改 await getSchema() */
  schema?: SchemaOverview;
  /** 當前交易（filter 事件的、或 transaction() 開的），scope 內的 items() / services 自動落在它\
   *  無則退回 top-level 連線（endpoint / schedule / after* 事件）
   */
  knex?: Knex;
}

export const contextStore = new AsyncLocalStorage<KitContextScope>()
