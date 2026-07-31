// endpoint domain 型別測試（vitest --typecheck）：guard 回傳物件 merge 進 handler ctx（型別累加）、
// guard ctx 自帶 DataAccess（寫在外部模組的 guard 也能查資料）

import { body, RAW, reply } from 'directus-typed-kit'
import { describe, expectTypeOf, it } from 'vitest'

import type {
  EndpointTools,
  Guard,
  Reply,
  RouteContext,
  StandardSchemaV1,
  TypedItemsService,
} from 'directus-typed-kit'

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

describe('guard ctx 自帶 DataAccess', () => {
  // 可重用 guard 寫在 route 之外、拿不到 createEndpoint 閉包，資料查詢只能靠 ctx 自帶存取器
  const loadItem: Guard<{ item: { id: string } }, Schema> = async (ctx) => {
    const row = await ctx.items('items').readOne(ctx.params.id!, { fields: ['id'] })
    expectTypeOf(row).toEqualTypeOf<{ id: string }>()
    expectTypeOf(ctx.knex('items')).not.toBeNever()
    expectTypeOf(ctx.transaction).not.toBeNever()
    return { item: row }
  }

  it('guard 內可查資料，extra 仍累加進 handler ctx', () => {
    const tools = {} as EndpointTools<Schema>
    tools.route.get('/:id', { guards: [loadItem] }, (ctx) => {
      expectTypeOf(ctx.item).toEqualTypeOf<{ id: string }>()
      // handler ctx 同樣自帶存取器
      expectTypeOf(ctx.items('items')).toEqualTypeOf<TypedItemsService<Schema, 'items'>>()
    })
  })
})

describe('MergeExtras 對各種 guard 形狀', () => {
  const tools = {} as EndpointTools<Schema>

  it('條件式回傳（某分支不回值）的 guard，extras 仍推得出來', () => {
    async function maybeGuard(ctx: RouteContext<Schema>) {
      if (ctx.accountability)
        return { who: ctx.accountability.user }
    }
    tools.route.get('/a', { guards: [maybeGuard] }, (ctx) => {
      expectTypeOf(ctx.who).toEqualTypeOf<string | null>()
    })
  })

  it('純 void guard（只 throw 不回值）不吃掉後續 guard 的 extras', () => {
    const gate = (_ctx: RouteContext<Schema>): void => {}
    const load = async (_ctx: RouteContext<Schema>) => ({ loaded: true as const })
    tools.route.get('/b', { guards: [gate, load] }, (ctx) => {
      expectTypeOf(ctx.loaded).toEqualTypeOf<true>()
    })
  })

  it('內建 guard 與自訂 guard 混用，兩邊 extras 都保留', () => {
    const schema = {} as StandardSchemaV1<unknown, { n: number }>
    tools.route.post('/c', {
      guards: [body(schema), async (ctx: RouteContext<Schema>) => ({ id: ctx.params.id! })],
    }, (ctx) => {
      expectTypeOf(ctx.body).toEqualTypeOf<{ n: number }>()
      expectTypeOf(ctx.id).toEqualTypeOf<string>()
    })
  })
})

// 宣告與實作在同一個呼叫裡，接不起來的話只有 runtime 的 500 會說話
describe('response schema 綁定 handler 回傳', () => {
  const tools = {} as EndpointTools<Schema>
  const schema = {} as StandardSchemaV1<unknown, { ok: boolean }>

  it('形狀對得上即通過（裸值 / reply / RAW / 空 body）', () => {
    tools.route.get('/a', { response: schema }, () => ({ ok: true }))
    tools.route.get('/b', { response: schema }, () => reply(201, { ok: true }))
    // RAW：handler 自行寫 res，wrapper 既不驗證也不序列化
    tools.route.get('/c', { response: schema }, () => RAW)
    // 空 body 不受形狀約束（204 本就不帶 body）
    tools.route.get('/d', { response: schema }, () => reply(204))
  })

  it('形狀不符 → 編譯錯', () => {
    // @ts-expect-error 回傳形狀與 response schema 不符
    tools.route.get('/e', { response: schema }, () => ({ totally: 'wrong' }))
    // @ts-expect-error reply 的 body 與 response schema 不符
    tools.route.get('/f', { response: schema }, () => reply(201, 'not-an-object'))
    // @ts-expect-error 有 response schema 卻漏 return
    tools.route.get('/g', { response: schema }, () => {})
  })

  it('無 response schema 時回傳不受限', () => {
    tools.route.get('/h', { guards: [] }, () => ({ anything: 1 }))
    tools.route.get('/i', () => undefined)
  })

  it('與 guards 併用時 extras 仍累加', () => {
    tools.route.get('/j', {
      guards: [async () => ({ who: 'me' as const })],
      response: schema,
    }, (ctx) => {
      expectTypeOf(ctx.who).toEqualTypeOf<'me'>()
      return { ok: true }
    })
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
