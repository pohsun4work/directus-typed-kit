import { ValidationError } from '../core/errors.js'
import { runStandard } from '../schema/standard-schema.js'

import type { InferOutput, StandardSchemaV1 } from '../schema/standard-schema.js'
import type { Reply, RequestGuard } from './types.js'

/** streaming 等需要自己寫 res 時，handler 回傳 RAW 告知 wrapper 放手、不序列化回傳值 */
export const RAW: unique symbol = Symbol('directus-typed-kit:raw')

/** Reply 的 brand key：unique symbol 讓 Reply 型別能綁定它，手寫物件無此 key 即無法冒充 */
export const REPLY: unique symbol = Symbol('directus-typed-kit:reply')

/** body 省略 → 空 body（如 204），且 `Reply<undefined>` 對任何 response schema 都放行 */
export function reply(status: number): Reply<undefined>
export function reply<B>(status: number, body: B): Reply<B>
export function reply(status: number, body?: unknown): Reply<unknown> {
  return { [REPLY]: true, status, body }
}

export function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[REPLY] === true
}

function makeSchemaGuard<K extends 'body' | 'query' | 'params'>(key: K) {
  return <Sc extends StandardSchemaV1>(schema: Sc): RequestGuard<{ [P in K]: InferOutput<Sc> }> =>
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
