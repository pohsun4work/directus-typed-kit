// endpoint domain 型別測試（vitest --typecheck）：guard 回傳物件 merge 進 handler ctx（型別累加）

import { describe, expectTypeOf, it } from 'vitest'

import type { EndpointTools } from 'directus-kit'

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
