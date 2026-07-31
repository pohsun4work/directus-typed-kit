// 必須用 Directus 的 createError 才會轉成對應 HTTP 狀態碼，直接 throw 一般 Error 會變 500
// throw 後交由 Directus error handler 回狀態碼，kit 本身不攔

import { createError } from '@directus/errors'

/** definePermission check 不通過時丟出（admin 已在上層放行）\
 *  message 傳 function 才吃得到 extensions —— 傳字串時 @directus/errors 直接用該字串，
 *  呼叫端給的 `opts.message` 會只留在 extensions.reason、進不了回應 message
 */
export const ForbiddenError = createError<{ reason?: string }>(
  'FORBIDDEN',
  (ext) => ext?.reason ?? 'Permission denied',
  403,
)

/** hook validate() / endpoint body()/query()/params() 驗證失敗 */
export const ValidationError = createError<{ issues: string[] }>(
  'FAILED_VALIDATION',
  (ext) => (ext?.issues?.length ? ext.issues.join('; ') : 'Validation failed'),
  400,
)

/** response schema 驗證失敗屬 server bug 回 500，細節進 log 不外洩 */
export const ResponseValidationError = createError(
  'RESPONSE_VALIDATION_FAILED',
  'Response did not match the expected schema',
  500,
)
