// kit 只依賴 Standard Schema 規範介面（@standard-schema/spec）

import type { StandardSchemaV1 } from '@standard-schema/spec'

export type { StandardSchemaV1 } from '@standard-schema/spec'

/** 從 Standard Schema 取出 output 型別，body()/query() 推導 handler ctx 用\
 *  刻意不約束型別參數，呼叫端（SchemaGuardOutput）的型別參數本身未約束，套約束會連鎖報錯
 */
export type InferOutput<Sc> = Sc extends StandardSchemaV1<unknown, infer O> ? O : never

/** 跑一次 Standard Schema 驗證，回 discriminated result，由呼叫端決定錯誤狀態碼
 *  - hook validate / endpoint body → 400
 *  - response 契約 → 500
 */
export async function runStandard<Sc extends StandardSchemaV1>(
  schema: Sc,
  value: unknown,
): Promise<{ value: InferOutput<Sc> } | { issues: string[] }> {
  // 直接 await：`instanceof Promise` 對非原生 thenable 為 false，會把未解析的結果當成功值放行
  const result = await schema['~standard'].validate(value)
  if (result.issues) {
    // 帶上 path，否則多欄位失敗時客戶端只收到 "Required; Required" 無從定位
    return {
      issues: result.issues.map((i) => {
        const path = i.path?.map((seg) => (typeof seg === 'object' ? String(seg.key) : String(seg))).join('.')
        return path ? `${path}: ${i.message}` : i.message
      }),
    }
  }
  return { value: result.value as InferOutput<Sc> }
}
