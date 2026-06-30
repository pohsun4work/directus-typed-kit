// kit 只依賴 Standard Schema 規範介面（@standard-schema/spec）
// hook 的 validate() 與 endpoint 的 body()/query()/params() 都建在這層之上

import type { StandardSchemaV1 } from '@standard-schema/spec'

export type { StandardSchemaV1 } from '@standard-schema/spec'

/** 從 Standard Schema 取出 output 型別（body()/query() 推導 handler ctx 用）\
 *  無約束 conditional：呼叫端（SchemaGuardOutput）的型別參數本身未約束，套約束會連鎖報錯
 */
export type InferOutput<Sc> = Sc extends StandardSchemaV1<unknown, infer O> ? O : never

/** 跑一次 Standard Schema 驗證；回 discriminated result，由呼叫端決定錯誤狀態碼\
 *  （hook validate / endpoint body → 400；response 契約 → 500）
 */
export async function runStandard<Sc extends StandardSchemaV1>(
  schema: Sc,
  value: unknown,
): Promise<{ value: InferOutput<Sc> } | { issues: string[] }> {
  let result = schema['~standard'].validate(value)
  if (result instanceof Promise)
    result = await result
  if (result.issues)
    return { issues: result.issues.map((i) => i.message) }
  return { value: result.value as InferOutput<Sc> }
}
