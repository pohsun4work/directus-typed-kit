import { ForbiddenError, ValidationError } from '../core/errors.js'
import { runStandard } from '../schema/standard-schema.js'

import type { WritePayload } from '../data-access/typed-items.js'
import type { StandardSchemaV1 } from '../schema/standard-schema.js'
import type { FilterMiddleware, GateMiddleware, MiddlewareHandler, PermissionCheck } from './types.js'

/** 授權 middleware 的 runtime 標記，讓 after* / action 在註冊期就擋下（型別被 cast 繞過時的第二道） */
export const GATE: unique symbol = Symbol('directus-typed-kit:gate')

export function applyFilterMiddleware<T>(
  middleware: FilterMiddleware[],
  handler: MiddlewareHandler<T>,
): MiddlewareHandler<T> {
  return middleware.reduceRight<MiddlewareHandler<T>>((next, m) => m(next), handler)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** parsed 疊回原 payload 而非取代：schema 通常只列要驗的欄位，而 zod / valibot 預設 strip 未列的，\
 *  直接取代會讓 auto-return 把縮水的 payload 交回 Directus、未列欄位靜默寫不進去
 */
export function validate<Sc extends StandardSchemaV1>(schema: Sc): FilterMiddleware {
  return (<T>(next: MiddlewareHandler<T>): MiddlewareHandler<T> =>
    async (payload, meta, ctx) => {
      const result = await runStandard(schema, payload)
      if ('issues' in result)
        throw new ValidationError({ issues: result.issues })
      // delete 事件的 payload 是 keys 陣列，攤進物件會變 { 0: 'a' }，故只在兩邊都是物件時合併
      const merged = isPlainObject(payload) && isPlainObject(result.value)
        ? { ...payload, ...result.value }
        : result.value
      return next(merged as WritePayload<T>, meta, ctx)
    }) as FilterMiddleware
}

/** admin 與 system 自動放行，但只略過授權那層 —— handler body 仍照常執行（admin 也要雜湊密碼 / 驗檔名）\
 *  accountability 為 null 即 system（`as:'system'` 或 Directus 內部流程），權限等同 admin 故一併放行
 */
export function definePermission(
  check: PermissionCheck,
  opts?: { message?: string },
): GateMiddleware {
  const gate = (<T>(next: MiddlewareHandler<T>): MiddlewareHandler<T> =>
    async (payload, meta, ctx) => {
      if (ctx.accountability === null || ctx.accountability.admin)
        return next(payload, meta, ctx)
      const ok = await check({
        payload: (payload ?? {}) as Record<string, unknown>,
        meta,
        accountability: ctx.accountability,
      })
      if (!ok)
        throw new ForbiddenError({ reason: opts?.message })
      return next(payload, meta, ctx)
    }) as FilterMiddleware
  return Object.assign(gate, { [GATE]: true as const })
}
