// endpoint domain 型別測試（vitest --typecheck）：guard 回傳物件 merge 進 handler ctx（型別累加）

import { reply } from 'directus-typed-kit'
import { describe, expectTypeOf, it } from 'vitest'

import type { EndpointTools, Reply } from 'directus-typed-kit'

// guard ctx 累加與 Schema 內容無關，給最小 SchemaShape 即可
interface Schema {
  items: { id: string }[];
}

describe('endpoint guard ctx 累加', () => {
  it('guards 回傳物件 merge 進 handler ctx（型別累加）', () => {
    const tools = {} as EndpointTools<Schema>
    tools.route.get(
      '/:token',
      { guards: [async () => ({ link: 'abc' as const })] },
      (ctx) => {
        expectTypeOf(ctx.link).toEqualTypeOf<'abc'>()
        expectTypeOf(ctx.params).toEqualTypeOf<Record<string, string>>()
      },
    )
  })
})

describe('Reply brand', () => {
  it('reply() 產出可賦值為 Reply', () => {
    expectTypeOf(reply(201, { ok: true })).toMatchTypeOf<Reply>()
  })

  it('手寫 { status, body } 無 REPLY brand 無法冒充 Reply', () => {
    // @ts-expect-error 缺私有 REPLY brand
    const fake: Reply = { status: 200, body: 'x' }
    void fake
  })
})
