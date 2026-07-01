// endpoint 這側的 Standard Schema guard（body/query/params）＋ 回傳語義 sentinel（reply / RAW）

import { ValidationError } from '../core/errors.js'
import { runStandard } from '../schema/standard-schema.js'

import type { InferOutput, StandardSchemaV1 } from '../schema/standard-schema.js'
import type { Guard, Reply } from './types.js'

/** streaming 等需要自己寫 res 時，handler 回傳 RAW 告知 wrapper 放手、不序列化回傳值 */
export const RAW: unique symbol = Symbol('directus-typed-kit:raw')

/** Reply 的 brand key：unique symbol 讓 Reply 型別能綁定它，手寫物件無此 key 即無法冒充 */
export const REPLY: unique symbol = Symbol('directus-typed-kit:reply')

/** 指定狀態碼回應，取代手動 res.status().json()
 * body 省略 → 空 body（如 204）
 */
export function reply(status: number, body?: unknown): Reply {
  return { [REPLY]: true, status, body }
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
