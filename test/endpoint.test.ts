// endpoint runtime 測試：route wrapper 的回傳語義（一般值 / reply / RAW / undefined）、
// guards 依序與短路、response 契約驗證、錯誤轉交 next、per-request contextStore

import { describe, expect, it, vi } from 'vitest'

import { ResponseValidationError, ValidationError } from '../src/core/errors.js'
import { buildEndpointTools } from '../src/endpoint/build.js'
import { body, RAW, reply } from '../src/endpoint/schema-guards.js'

import type { Accountability } from '../src/core/types.js'
import type { StandardSchemaV1 } from '../src/schema/standard-schema.js'

interface Schema {
  files: { id: string; file: string }[];
}

type RouteHandler = (req: unknown, res: unknown, next: unknown) => Promise<void>

function makeRes() {
  const res = {
    headersSent: false,
    statusCode: undefined as number | undefined,
    payload: undefined as unknown,
    ended: false,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(value: unknown) {
      res.payload = value
      res.headersSent = true
      return res
    },
    end() {
      res.ended = true
      res.headersSent = true
      return res
    },
  }
  return res
}

function setup() {
  const routes = new Map<string, RouteHandler>()
  const register = (method: string) => (path: string, handler: RouteHandler) => {
    routes.set(`${method} ${path}`, handler)
  }
  const router = { get: register('get'), post: register('post'), put: register('put'), patch: register('patch'), delete: register('delete') }

  // 建構 ItemsService 時拿到的 accountability 即 resolveAccountability('caller') 的產物
  const itemsAccountability: (Accountability | null)[] = []
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }
  const context = {
    database: {},
    services: {
      ItemsService: class {
        constructor(_collection: string, options: { accountability: Accountability | null }) {
          itemsAccountability.push(options.accountability)
        }

        async readByQuery() {
          return []
        }
      },
    },
    getSchema: async () => ({}),
    logger,
  }
  const tools = buildEndpointTools<Schema>(router as never, context as never)

  const call = async (key: string, req: Record<string, unknown> = {}) => {
    const res = makeRes()
    const next = vi.fn()
    await routes.get(key)!({ params: {}, query: {}, body: undefined, ...req }, res, next)
    return { res, next }
  }

  return { tools, call, logger, itemsAccountability }
}

/** 最小 Standard Schema：validate 由測試決定同步 / 非同步與成敗 */
function schemaOf<T>(validate: StandardSchemaV1<unknown, T>['~standard']['validate']): StandardSchemaV1<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate } }
}

describe('回傳語義', () => {
  it('一般值 → 200 + json', async () => {
    const { tools, call } = setup()
    tools.route.get('/a', () => ({ ok: true }))
    const { res, next } = await call('get /a')
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ ok: true })
    expect(next).not.toHaveBeenCalled()
  })

  it('reply(status, body) → 指定狀態碼 + json', async () => {
    const { tools, call } = setup()
    tools.route.post('/a', () => reply(201, { id: 'x' }))
    const { res } = await call('post /a')
    expect(res.statusCode).toBe(201)
    expect(res.payload).toEqual({ id: 'x' })
  })

  it('reply 省略 body → end()，不掛 json', async () => {
    const { tools, call } = setup()
    tools.route.delete('/a', () => reply(204))
    const { res } = await call('delete /a')
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
    expect(res.payload).toBeUndefined()
  })

  it('handler 無回傳 → 200 + end()', async () => {
    const { tools, call } = setup()
    tools.route.get('/a', () => {})
    const { res } = await call('get /a')
    expect(res.statusCode).toBe(200)
    expect(res.ended).toBe(true)
  })

  it('回傳 RAW → wrapper 放手，完全不碰 res', async () => {
    const { tools, call } = setup()
    tools.route.get('/a', () => RAW)
    const { res, next } = await call('get /a')
    expect(res.headersSent).toBe(false)
    expect(res.statusCode).toBeUndefined()
    expect(next).not.toHaveBeenCalled()
  })

  it('handler 已寫 res 卻漏回 RAW → 不重複寫（否則 header 重送會打斷連線）', async () => {
    const { tools, call } = setup()
    tools.route.get('/a', (ctx) => {
      ctx.res.status(302).json({ redirected: true })
      return { ignored: true }
    })
    const { res, next } = await call('get /a')
    expect(res.statusCode).toBe(302)
    expect(res.payload).toEqual({ redirected: true })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('錯誤轉交 next', () => {
  it('handler throw → next(err)，res 未寫', async () => {
    const { tools, call } = setup()
    const boom = new Error('boom')
    tools.route.get('/a', () => {
      throw boom
    })
    const { res, next } = await call('get /a')
    expect(next).toHaveBeenCalledWith(boom)
    expect(res.headersSent).toBe(false)
  })

  it('handler 的 async rejection 同樣進 next（express 4 不自動接）', async () => {
    const { tools, call } = setup()
    const boom = new Error('async boom')
    tools.route.get('/a', async () => {
      await Promise.resolve()
      throw boom
    })
    const { next } = await call('get /a')
    expect(next).toHaveBeenCalledWith(boom)
  })

  it('guard throw → 中止後續 guard 與 handler', async () => {
    const { tools, call } = setup()
    const later = vi.fn()
    const handler = vi.fn()
    tools.route.get('/a', {
      guards: [
        () => {
          throw new Error('denied')
        },
        later,
      ],
    }, handler)
    const { next } = await call('get /a')
    expect(next).toHaveBeenCalled()
    expect(later).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('guards', () => {
  it('依書寫順序執行，回傳物件累加進 ctx', async () => {
    const { tools, call } = setup()
    const order: string[] = []
    tools.route.get('/a', {
      guards: [
        () => {
          order.push('first')
          return { a: 1 }
        },
        () => {
          order.push('second')
          return { b: 2 }
        },
      ],
    }, (ctx) => {
      order.push('handler')
      return { a: (ctx as { a: number }).a, b: (ctx as { b: number }).b }
    })
    const { res } = await call('get /a')
    expect(order).toEqual(['first', 'second', 'handler'])
    expect(res.payload).toEqual({ a: 1, b: 2 })
  })

  it('guard 自行寫 res 即短路：後續 guard 與 handler 都不跑', async () => {
    const { tools, call } = setup()
    const later = vi.fn()
    const handler = vi.fn()
    tools.route.get('/a', {
      guards: [
        (ctx) => {
          ctx.res.status(302).json({ to: '/login' })
        },
        later,
      ],
    }, handler)
    const { res, next } = await call('get /a')
    expect(res.statusCode).toBe(302)
    expect(later).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('guard 覆寫 accountability → throw（ctx 與 contextStore 會分岔）', async () => {
    const { tools, call } = setup()
    tools.route.get('/a', {
      guards: [() => ({ accountability: { admin: true } } as never)],
    }, () => ({}))
    const { next } = await call('get /a')
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('accountability') }))
  })

  it('guard 覆寫存取器（items）→ throw', async () => {
    const { tools, call } = setup()
    tools.route.get('/a', { guards: [() => ({ items: () => ({}) } as never)] }, () => ({}))
    const { next } = await call('get /a')
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('items') }))
  })

  it('body() 驗證失敗 → ValidationError（400），handler 不跑', async () => {
    const { tools, call } = setup()
    const handler = vi.fn()
    const schema = schemaOf<{ n: number }>(() => ({ issues: [{ message: 'expected number', path: ['n'] }] }))
    tools.route.post('/a', { guards: [body(schema)] }, handler)
    const { next } = await call('post /a', { body: { n: 'x' } })
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError))
    expect(handler).not.toHaveBeenCalled()
  })

  it('body() 成功 → ctx.body 換成 parsed 值', async () => {
    const { tools, call } = setup()
    const schema = schemaOf<{ n: number }>((value) => ({ value: { n: Number((value as { n: string }).n) } }))
    tools.route.post('/a', { guards: [body(schema)] }, (ctx) => ctx.body)
    const { res } = await call('post /a', { body: { n: '42' } })
    expect(res.payload).toEqual({ n: 42 })
  })
})

describe('response 契約', () => {
  it('不符 → 500 ResponseValidationError，細節只進 log 不外洩', async () => {
    const { tools, call, logger } = setup()
    const schema = schemaOf(() => ({ issues: [{ message: 'missing ok' }] }))
    tools.route.get('/a', { response: schema }, () => ({ wrong: true }))
    const { next, res } = await call('get /a')
    expect(next).toHaveBeenCalledWith(expect.any(ResponseValidationError))
    expect(res.headersSent).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ issues: ['missing ok'] }),
      expect.stringContaining('response validation failed'),
    )
  })

  it('通過 → 回應用 parsed 值（非 handler 原值）', async () => {
    const { tools, call } = setup()
    // 兩個欄位都在 schema 的 output 上，handler 才回得出「與 parsed 不同」的原值
    const schema = schemaOf<{ raw?: boolean; normalized?: boolean }>(() => ({ value: { normalized: true } }))
    tools.route.get('/a', { response: schema }, () => ({ raw: true }))
    const { res } = await call('get /a')
    expect(res.payload).toEqual({ normalized: true })
  })

  it('handler 漏 return 時也驗（有契約卻回 undefined 屬破約，不靜默放行）', async () => {
    const { tools, call } = setup()
    const schema = schemaOf((value) => (value === undefined ? { issues: [{ message: 'required' }] } : { value }))
    tools.route.get('/a', { response: schema }, () => {})
    const { next } = await call('get /a')
    expect(next).toHaveBeenCalledWith(expect.any(ResponseValidationError))
  })
})

describe('註冊期守衛', () => {
  it('漏傳 handler → 註冊當下就 throw（否則 guards 沒掛上、第一個請求才炸）', () => {
    const { tools } = setup()
    expect(() => tools.route.get('/a', { guards: [] } as never))
      .toThrow(/缺少 handler/)
  })
})

describe('per-request contextStore', () => {
  it('items() 預設身分為本請求的 accountability，且穿得過 await', async () => {
    const { tools, call, itemsAccountability } = setup()
    const acc = { user: 'u1', admin: false } as unknown as Accountability
    tools.route.get('/a', async (ctx) => {
      await Promise.resolve()
      await ctx.items('files').readByQuery({})
      return {}
    })
    await call('get /a', { accountability: acc })
    expect(itemsAccountability).toEqual([acc])
  })
})
