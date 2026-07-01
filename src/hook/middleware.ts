// 兩個內建 FilterMiddleware（validate / definePermission）與套用器
// 套用順序刻意對齊 endpoint guards（書寫順序＝執行順序），呼叫端心智模型一致

import { ForbiddenError, ValidationError } from '../core/errors.js'
import { runStandard } from '../schema/standard-schema.js'

import type { WritePayload } from '../data-access/typed-items.js'
import type { StandardSchemaV1 } from '../schema/standard-schema.js'
import type { FilterHandler, FilterMiddleware, PermissionCheck } from './types.js'

/** 套用順序＝書寫順序：index 0 最外層、最先執行 */
export function applyFilterMiddleware<T>(
  middleware: FilterMiddleware[],
  handler: FilterHandler<T>,
): FilterHandler<T> {
  return middleware.reduceRight<FilterHandler<T>>((next, m) => m(next), handler)
}

/** Standard Schema 驗證 middleware：parse payload，不符 throw（400），成功把 parsed 往下傳 */
export function validate<Sc extends StandardSchemaV1>(schema: Sc): FilterMiddleware {
  return (<T>(next: FilterHandler<T>): FilterHandler<T> =>
    async (payload, meta, ctx) => {
      const result = await runStandard(schema, payload)
      if ('issues' in result)
        throw new ValidationError({ issues: result.issues })
      return next(result.value as WritePayload<T>, meta, ctx)
    }) as FilterMiddleware
}

/** 唯一授權接縫：admin 自動放行、check() false → throw Forbidden、true → 放行\
 *  handler body 仍照常執行（admin 也要雜湊密碼 / 驗檔名），只有授權那層對 admin 略過
 */
export function definePermission(
  check: PermissionCheck,
  opts?: { message?: string },
): FilterMiddleware {
  return (<T>(next: FilterHandler<T>): FilterHandler<T> =>
    async (payload, meta, ctx) => {
      if (ctx.accountability?.admin)
        return next(payload, meta, ctx)
      const ok = await check({
        payload: (payload ?? {}) as Record<string, unknown>,
        meta,
        accountability: ctx.accountability ?? null,
      })
      if (!ok)
        throw new ForbiddenError({ reason: opts?.message })
      return next(payload, meta, ctx)
    }) as FilterMiddleware
}
