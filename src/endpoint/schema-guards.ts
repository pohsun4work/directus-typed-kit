// endpoint 這側的 Standard Schema guard（body/query/params）＋ 回傳語義 sentinel（reply / RAW）
// guard 與 hook 的 validate() 共用同一驗證抽象；成功把 typed 值併進 ctx，失敗自動 400

import { ValidationError } from '../core/errors.js'
import { runStandard } from '../schema/standard-schema.js'

import type { InferOutput, StandardSchemaV1 } from '../schema/standard-schema.js'
import type { Guard, Reply } from './types.js'

/** streaming 等需要自己寫 res 時，handler 回傳 RAW 告知 wrapper 放手、不序列化回傳值 */
export const RAW: unique symbol = Symbol('directus-kit:raw')

const REPLY = Symbol('directus-kit:reply')

/** 指定狀態碼回應（取代 res.status().json(); return）\
 *  body 省略 → 空 body（如 204）
 */
export function reply(status: number, body?: unknown): Reply {
  return { [REPLY]: true, status, body } as Reply
}

export function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[REPLY] === true
}

/** 驗 ctx 上的某欄位（body / query / params），成功回 { [key]: typed }，失敗 throw 400 */
function makeSchemaGuard<K extends 'body' | 'query' | 'params'>(key: K) {
  return <Sc extends StandardSchemaV1>(schema: Sc): Guard<{ [P in K]: InferOutput<Sc> }> =>
    async (ctx) => {
      const result = await runStandard(schema, ctx[key])
      if ('issues' in result)
        throw new ValidationError({ issues: result.issues })
      return { [key]: result.value } as { [P in K]: InferOutput<Sc> }
    }
}

export const body = makeSchemaGuard('body')
export const query = makeSchemaGuard('query')
export const params = makeSchemaGuard('params')
