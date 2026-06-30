// 用 Directus 的 createError 才會轉成對應 HTTP 狀態碼
// 直接 throw 一般 Error 會變成 500
// guard / validate / filter 內 throw 這些實例後交由 Directus error handler 回對應狀態碼，kit 本身不攔

import { createError } from '@directus/errors'

/** definePermission check 不通過時丟出（admin 已在上層放行） */
export const ForbiddenError = createError<{ reason?: string }>('FORBIDDEN', 'Permission denied', 403)

/** hook validate() / endpoint body()/query()/params() 驗證失敗 */
export const ValidationError = createError<{ issues: string[] }>(
  'FAILED_VALIDATION',
  (ext) => (ext?.issues?.length ? ext.issues.join('; ') : 'Validation failed'),
  400,
)

/** response schema 驗證失敗 = server bug → 500（細節進 log，不外洩） */
export const ResponseValidationError = createError(
  'RESPONSE_VALIDATION_FAILED',
  'Response did not match the expected schema',
  500,
)
