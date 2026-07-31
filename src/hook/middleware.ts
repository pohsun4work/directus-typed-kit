// 兩個內建 FilterMiddleware（validate / definePermission）與套用器
// 套用順序刻意對齊 endpoint guards（書寫順序＝執行順序），呼叫端心智模型一致

import { ForbiddenError, ValidationError } from '../core/errors.js'
import { runStandard } from '../schema/standard-schema.js'

import type { WritePayload } from '../data-access/typed-items.js'
import type { StandardSchemaV1 } from '../schema/standard-schema.js'
import type { FilterMiddleware, MiddlewareHandler, PermissionCheck } from './types.js'

/** 套用順序＝書寫順序：index 0 最外層、最先執行 */
export function applyFilterMiddleware<T>(
  middleware: FilterMiddleware[],
  handler: MiddlewareHandler<T>,
): MiddlewareHandler<T> {
  return middleware.reduceRight<MiddlewareHandler<T>>((next, m) => m(next), handler)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Standard Schema 驗證 middleware：parse payload，不符 throw（400），成功把 parsed 往下傳\
 *  parsed 疊回原 payload 而非取代：schema 通常只列要驗的欄位，而 zod / valibot 預設 strip 未列的，
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

/** 唯一授權接縫：admin 與 system 自動放行、check() false → throw Forbidden、true → 放行\
 *  handler body 仍照常執行（admin 也要雜湊密碼 / 驗檔名），只有授權那層略過\
 *  accountability 為 null 即 system（`as:'system'` 或 Directus 內部流程），權限等同 admin 故一併放行
 */
export function definePermission(
  check: PermissionCheck,
  opts?: { message?: string },
): FilterMiddleware {
  return (<T>(next: MiddlewareHandler<T>): MiddlewareHandler<T> =>
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
}
