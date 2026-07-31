// kit runtime 測試：before* 省略 handler 時的純 gate 行為
// definePermission 是 throw-or-pass 的 middleware，本身即完整語意；省略 handler 時 build 補 no-op 收尾
// 驗證無 handler 下 gate 仍正確擋下 / 放行，且放行時 payload 原樣回傳（沿用 auto-return）

import { describe, expect, it, vi } from 'vitest'

import { contextStore } from '../src/core/context.js'
import { ForbiddenError } from '../src/core/errors.js'
import { buildHookTools } from '../src/hook/build.js'
import { definePermission, validate } from '../src/hook/middleware.js'

import type { Accountability } from '../src/core/types.js'
import type { ServiceAs } from '../src/data-access/directus-services.js'
import type { WritePayload } from '../src/data-access/typed-items.js'
import type { FilterMiddleware, MiddlewareHandler } from '../src/hook/types.js'
import type { StandardSchemaV1 } from '../src/schema/standard-schema.js'

interface Schema {
  files: { id: string; file: string }[];
}

type EventsArg = Parameters<typeof buildHookTools>[0]
type ContextArg = Parameters<typeof buildHookTools>[1]
type NativeFilterHandler = Parameters<EventsArg['filter']>[1]

// 蒐集 native filter 註冊，回傳可手動觸發的 tools 與 handler 表
function setup() {
  const handlers = new Map<string, NativeFilterHandler>()
  const events: EventsArg = {
    filter: (event, handler) => {
      handlers.set(event, handler)
    },
    action: () => {},
    schedule: () => {},
    init: () => {},
    embed: () => {},
  }
  const context: ContextArg = {
    database: {},
    services: {},
    getSchema: async () => ({}),
    logger: console as unknown as ContextArg['logger'],
  }
  const tools = buildHookTools<Schema>(events, context)
  return { tools, handlers }
}

describe('before* 省略 handler（純 middleware gate）', () => {
  it('非 admin 且 check false → throw Forbidden', async () => {
    const { tools, handlers } = setup()
    tools.beforeCreate('files', [definePermission(() => false, { message: 'nope' })])
    const run = handlers.get('files.items.create')!
    await expect(run({ file: 'f1' }, { keys: ['1'] }, { accountability: { admin: false } }))
      .rejects
      .toBeInstanceOf(ForbiddenError)
  })

  it('非 admin 且 check true → 放行並原樣回傳 payload', async () => {
    const { tools, handlers } = setup()
    const payload = { file: 'f1' }
    tools.beforeCreate('files', [definePermission(() => true)])
    const run = handlers.get('files.items.create')!
    await expect(run(payload, { keys: ['1'] }, { accountability: { admin: false } }))
      .resolves
      .toBe(payload)
  })

  it('admin → 跳過 check（不呼叫）並原樣回傳 payload', async () => {
    const { tools, handlers } = setup()
    const payload = { file: 'f1' }
    const check = vi.fn(() => false)
    tools.beforeCreate('files', [definePermission(check)])
    const run = handlers.get('files.items.create')!
    await expect(run(payload, { keys: ['1'] }, { accountability: { admin: true } }))
      .resolves
      .toBe(payload)
    expect(check).not.toHaveBeenCalled()
  })

  it('beforeDelete 省略 handler 也走 no-op（gate 放行、payload 即 keys 陣列原樣回傳）', async () => {
    const { tools, handlers } = setup()
    tools.beforeDelete('files', [definePermission(() => true)])
    const run = handlers.get('files.items.delete')!
    await expect(run(['1'], { keys: ['1'] }, { accountability: { admin: false } }))
      .resolves
      .toEqual(['1'])
  })
})

// 蒐集 init 註冊 + app.use 掛載：可手動觸發某 phase 並取回掛上的 middleware
function setupRoutes() {
  const initHandlers = new Map<string, (meta: Record<string, unknown>) => void>()
  const mounted: { path: unknown; handler: (...a: unknown[]) => unknown }[] = []
  const app = {
    use: (...args: unknown[]) => {
      const hasPath = typeof args[0] !== 'function'
      mounted.push({
        path: hasPath ? args[0] : undefined,
        handler: (hasPath ? args[1] : args[0]) as (...a: unknown[]) => unknown,
      })
    },
  }
  const events: EventsArg = {
    filter: () => {},
    action: () => {},
    schedule: () => {},
    init: (event, handler) => {
      initHandlers.set(event, handler)
    },
    embed: () => {},
  }
  // 記錄每次 ItemsService 建構拿到的 accountability：驗證 caller scope 穿越 await
  const itemsServiceAccountability: (Accountability | null)[] = []
  const context: ContextArg = {
    database: {},
    services: {
      ItemsService: class {
        constructor(_collection: string, options: { accountability: Accountability | null }) {
          itemsServiceAccountability.push(options.accountability)
        }

        async readByQuery() {
          return []
        }
      },
    },
    getSchema: async () => ({}),
    logger: console as unknown as ContextArg['logger'],
  }
  const tools = buildHookTools<Schema>(events, context)
  const fire = (phase: string) => initHandlers.get(phase)?.({ app })
  return { tools, mounted, fire, itemsServiceAccountability }
}

describe('beforeRoutes / afterRoutes：per-request contextStore', () => {
  it('beforeRoutes：3 參數掛載，handler 內 contextStore 帶 req.accountability', async () => {
    const { tools, mounted, fire } = setupRoutes()
    let seen: unknown
    tools.beforeRoutes('/files', (_req, _res, next) => {
      seen = contextStore.getStore()?.accountability
      return next()
    })
    fire('routes.before')
    expect(mounted[0]!.path).toBe('/files')
    // express 靠 arity 分派：一般 middleware 需 3 參數
    expect(mounted[0]!.handler.length).toBe(3)

    const acc = { user: 'u1', admin: false }
    const next = vi.fn()
    await mounted[0]!.handler({ accountability: acc }, {}, next)
    expect(seen).toBe(acc)
    expect(next).toHaveBeenCalled()
  })

  it('beforeRoutes：caller scope 穿越 await —— items() 在 await resolveSchema 後仍取得 req.accountability', async () => {
    const { tools, mounted, fire, itemsServiceAccountability } = setupRoutes()
    const acc = { user: 'u1', admin: false } as unknown as Accountability
    // 真實路徑：items() 內部先 await resolveSchema() 才 resolveAccountability —— 鎖住「store 跨 await 存活」
    tools.beforeRoutes('/files', async (_req, _res, next) => {
      await tools.items('files').readByQuery({})
      next()
    })
    fire('routes.before')
    const next = vi.fn()
    await mounted[0]!.handler({ accountability: acc }, {}, next)
    // 建構 ItemsService 時拿到的 accountability 必須仍是 req 的（非 null）
    expect(itemsServiceAccountability).toEqual([acc])
    expect(next).toHaveBeenCalled()
  })

  it('afterRoutes：4 參數掛載（error handler），contextStore 自第 2 參 req 取 accountability，無則 null', async () => {
    const { tools, mounted, fire } = setupRoutes()
    let hadStore = false
    let seen: unknown
    tools.afterRoutes((_err, _req, _res, _next) => {
      const store = contextStore.getStore()
      hadStore = store !== undefined
      seen = store?.accountability
    })
    fire('routes.after')
    // express 靠 arity 認 error handler：須 4 參數
    expect(mounted[0]!.handler.length).toBe(4)

    await mounted[0]!.handler(new Error('boom'), { accountability: null }, {}, vi.fn())
    expect(hadStore).toBe(true)
    expect(seen).toBeNull()
  })
})

describe('filter context 帶事件交易', () => {
  it('native ctx 的 database / schema 原樣傳給 handler（同一實例，非另開連線）', async () => {
    const { tools, handlers } = setup()
    const database = { __trx: true }
    const schema = { collections: {} }
    let seen: { database: unknown; schema: unknown } | undefined
    tools.beforeUpdate('files', (_payload, _meta, ctx) => {
      seen = { database: ctx.database, schema: ctx.schema }
    })
    const run = handlers.get('files.items.update')!
    await run({ file: 'f1' }, { keys: ['1'] }, { accountability: null, database, schema })
    expect(seen?.database).toBe(database)
    expect(seen?.schema).toBe(schema)
  })

  it('handler 內的 items() 自動落在事件交易（免顯式傳 trx）', async () => {
    const seen: unknown[] = []
    const handlers = new Map<string, NativeFilterHandler>()
    const events: EventsArg = {
      filter: (event, handler) => {
        handlers.set(event, handler)
      },
      action: () => {},
      schedule: () => {},
      init: () => {},
      embed: () => {},
    }
    const topLevel = { __name: 'top-level' }
    const context: ContextArg = {
      database: topLevel,
      services: {
        ItemsService: class {
          constructor(_collection: string, options: { knex: unknown }) {
            seen.push(options.knex)
          }

          async readByQuery() {
            return []
          }
        },
      },
      getSchema: async () => ({}),
      logger: console as unknown as ContextArg['logger'],
    }
    const tools = buildHookTools<Schema>(events, context)

    const database = { __name: 'event-trx' }
    tools.beforeUpdate('files', async () => {
      await tools.items('files').readByQuery({})
    })
    await handlers.get('files.items.update')!({ file: 'f1' }, { keys: ['1'] }, { accountability: null, database })
    expect(seen).toEqual([database])

    // 對照：hook scope 外走 top-level 連線
    await tools.items('files').readByQuery({})
    expect(seen.at(-1)).toBe(topLevel)
  })

  it('beforeDelete 同樣拿到 database（參照完整性檢查須查同交易內狀態）', async () => {
    const { tools, handlers } = setup()
    const database = { __trx: true }
    let seen: unknown
    tools.beforeDelete('files', (_keys, _meta, ctx) => {
      seen = ctx.database
    })
    const run = handlers.get('files.items.delete')!
    await run(['1'], {}, { accountability: null, database })
    expect(seen).toBe(database)
  })
})

describe('filter 逃生口省略 handler（非 items 事件的純 gate）', () => {
  it('check true → no-op 放行、原樣回傳 payload（不因缺 handler 而 crash）', async () => {
    const { tools, handlers } = setup()
    const payload = { email: 'x' }
    tools.filter('auth.login', [definePermission(() => true)])
    const run = handlers.get('auth.login')!
    await expect(run(payload, { keys: [] }, { accountability: { admin: false } }))
      .resolves
      .toBe(payload)
  })

  it('check false → throw Forbidden（gate 仍生效）', async () => {
    const { tools, handlers } = setup()
    tools.filter('auth.login', [definePermission(() => false)])
    const run = handlers.get('auth.login')!
    await expect(run({ email: 'x' }, { keys: [] }, { accountability: { admin: false } }))
      .rejects
      .toBeInstanceOf(ForbiddenError)
  })
})

describe('after* middleware 轉換回灌 handler', () => {
  type ActionArg = Parameters<EventsArg['action']>[1]

  function setupAction() {
    const actions = new Map<string, ActionArg>()
    const events: EventsArg = {
      filter: () => {},
      action: (event, handler) => {
        actions.set(event, handler)
      },
      schedule: () => {},
      init: () => {},
      embed: () => {},
    }
    const context: ContextArg = {
      database: {},
      services: {},
      getSchema: async () => ({}),
      logger: console as unknown as ContextArg['logger'],
    }
    const tools = buildHookTools<Schema>(events, context)
    return { tools, actions }
  }

  it('middleware 改寫 payload → handler 讀到轉換後的值（非原始 meta.payload）', async () => {
    const { tools, actions } = setupAction()
    const bump: FilterMiddleware = <T>(next: MiddlewareHandler<T>): MiddlewareHandler<T> =>
      async (_payload, meta, ctx) => next({ file: 'coerced' } as unknown as WritePayload<T>, meta, ctx)
    let seen: unknown
    tools.afterCreate('files', [bump], (meta) => {
      seen = meta.payload
    })
    const run = actions.get('files.items.create')!
    await run({ payload: { file: 'raw' }, keys: ['1'] }, { accountability: { admin: false } })
    expect(seen).toEqual({ file: 'coerced' })
  })
})

describe('as 執行身分解析', () => {
  // 攔截 ItemsService 建構拿到的 accountability：即 resolveAccountability(as) 的產物
  function setupItems() {
    const seen: (Accountability | null)[] = []
    const context: ContextArg = {
      database: {},
      services: {
        ItemsService: class {
          constructor(_collection: string, options: { accountability: Accountability | null }) {
            seen.push(options.accountability)
          }

          async readByQuery() {
            return []
          }
        },
      },
      getSchema: async () => ({}),
      logger: console as unknown as ContextArg['logger'],
    }
    const events: EventsArg = { filter: () => {}, action: () => {}, schedule: () => {}, init: () => {}, embed: () => {} }
    const tools = buildHookTools<Schema>(events, context)
    const resolve = async (as: ServiceAs) => {
      await tools.items('files', { as }).readByQuery({})
      return seen.at(-1)
    }
    return { resolve }
  }

  it('物件形式只給部分欄位 → 其餘補預設（roles/ip 空、未給的 admin 為 false）', async () => {
    const { resolve } = setupItems()
    await expect(resolve({ admin: true, user: 'u1' })).resolves.toEqual({ user: 'u1', role: null, roles: [], admin: true, app: false, ip: null })
  })

  it('物件形式不給 admin → 預設 false（須顯式 true 才繞 ACL）', async () => {
    const { resolve } = setupItems()
    await expect(resolve({ user: 'u1' })).resolves.toEqual({ user: 'u1', role: null, roles: [], admin: false, app: false, ip: null })
  })

  it('\'admin\' 快捷 → admin:true、記名為 null、roles/ip 空', async () => {
    const { resolve } = setupItems()
    await expect(resolve('admin')).resolves.toEqual({ user: null, role: null, roles: [], admin: true, app: false, ip: null })
  })

  it('\'system\' 快捷 → null（不記名、繞 ACL）', async () => {
    const { resolve } = setupItems()
    await expect(resolve('system')).resolves.toBeNull()
  })

  // null 在 Directus 是 system（繞過全部 ACL），拿它當預設身分的 fallback 等於失敗方向朝 allow
  it('\'caller\'（預設）無 context store → 匿名身分而非 null', async () => {
    const { resolve } = setupItems()
    await expect(resolve('caller')).resolves.toEqual({ user: null, role: null, roles: [], admin: false, app: false, ip: null })
  })

  it('有 scope 但身分為 null（system 觸發的事件）→ 維持 null，不誤升為匿名', async () => {
    const { resolve } = setupItems()
    await expect(contextStore.run({ accountability: null }, () => resolve('caller')))
      .resolves
      .toBeNull()
  })
})

describe('validate middleware', () => {
  /** 只驗 title、其餘欄位不列（模擬 zod object 預設 strip 未列欄位） */
  const titleOnly: StandardSchemaV1<unknown, { title: string }> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => {
        const title = (value as { title?: unknown }).title
        return typeof title === 'string'
          ? { value: { title: title.trim() } }
          : { issues: [{ message: 'title is required', path: ['title'] }] }
      },
    },
  }

  it('parsed 疊回原 payload：schema 未列的欄位不被 strip 掉', async () => {
    const { tools, handlers } = setup()
    tools.beforeCreate('files', [validate(titleOnly)])
    const run = handlers.get('files.items.create')!
    await expect(run({ title: '  hi  ', body: 'kept', author: 'u1' }, { keys: [] }, { accountability: { admin: false } }))
      .resolves
      .toEqual({ title: 'hi', body: 'kept', author: 'u1' })
  })

  it('驗證失敗 → ValidationError，訊息帶欄位路徑', async () => {
    const { tools, handlers } = setup()
    tools.beforeCreate('files', [validate(titleOnly)])
    const run = handlers.get('files.items.create')!
    await expect(run({ body: 'x' }, { keys: [] }, { accountability: { admin: false } }))
      .rejects
      .toMatchObject({ message: 'title: title is required' })
  })

  it('delete 的 payload 是 keys 陣列 → 用 parsed 取代而非攤成物件', async () => {
    const { tools, handlers } = setup()
    const keysSchema: StandardSchemaV1<unknown, string[]> = {
      '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value: (value as string[]).map((k) => `k-${k}`) }) },
    }
    tools.beforeDelete('files', [validate(keysSchema)])
    const run = handlers.get('files.items.delete')!
    await expect(run(['1', '2'], {}, { accountability: { admin: false } }))
      .resolves
      .toEqual(['k-1', 'k-2'])
  })

  it('beforeDelete 的 handler 讀到 middleware 改寫後的 keys', async () => {
    const { tools, handlers } = setup()
    const keysSchema: StandardSchemaV1<unknown, string[]> = {
      '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value: (value as string[]).filter((k) => k !== '2') }) },
    }
    let seen: string[] | undefined
    tools.beforeDelete('files', [validate(keysSchema)], (keys) => {
      seen = keys
    })
    await handlers.get('files.items.delete')!(['1', '2', '3'], {}, { accountability: { admin: false } })
    expect(seen).toEqual(['1', '3'])
  })
})

describe('definePermission 的 system 身分', () => {
  it('accountability 為 null（system）→ 自動放行，不呼叫 check', async () => {
    const { tools, handlers } = setup()
    const check = vi.fn(() => false)
    tools.beforeCreate('files', [definePermission(check)])
    const payload = { file: 'f1' }
    await expect(handlers.get('files.items.create')!(payload, { keys: [] }, { accountability: null }))
      .resolves
      .toBe(payload)
    expect(check).not.toHaveBeenCalled()
  })

  it('opts.message 進得了回應 message（不只留在 extensions）', async () => {
    const { tools, handlers } = setup()
    tools.beforeCreate('files', [definePermission(() => false, { message: '只有擁有者可以刪除' })])
    await expect(handlers.get('files.items.create')!({}, { keys: [] }, { accountability: { admin: false } }))
      .rejects
      .toMatchObject({ message: '只有擁有者可以刪除' })
  })
})

describe('filter 逃生口不套 delete 特化', () => {
  it('payload 原樣進 handler、回傳值被採用（beforeDelete 才是 keys 語義那條）', async () => {
    const { tools, handlers } = setup()
    let seen: unknown
    tools.filter('files.items.delete', (payload) => {
      seen = payload
      return (payload as number[]).filter((k) => k !== 2)
    })
    await expect(handlers.get('files.items.delete')!([1, 2, 3], {}, { accountability: null }))
      .resolves
      .toEqual([1, 3])
    // 未被 String 化，仍是 Directus 給的原始值
    expect(seen).toEqual([1, 2, 3])
  })
})

describe('註冊期守衛', () => {
  it('after* 漏 handler → 註冊當下 throw（否則每次事件都在 commit 後才炸）', () => {
    const { tools } = setup()
    expect(() => tools.afterCreate('files', [definePermission(() => true)] as never))
      .toThrow(/缺少 handler/)
  })

  it('參數順序寫反（handler 在前、middleware 在後）→ throw，不靜默丟棄 gate', () => {
    const { tools } = setup()
    expect(() => tools.beforeCreate('files', (() => {}) as never, [definePermission(() => false)] as never))
      .toThrow(/middleware 陣列必須放在 handler 之前/)
  })

  it('第三參數不是函式 → throw', () => {
    const { tools } = setup()
    expect(() => tools.beforeCreate('files', [], [] as never))
      .toThrow(/第三參數必須是 handler 函式/)
  })
})

describe('action handler 的錯誤邊界', () => {
  it('handler throw → 記進 logger，不外拋（原生 action 簽章是 void、Directus 收不到這個 promise）', async () => {
    const actions = new Map<string, Parameters<EventsArg['action']>[1]>()
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }
    const events: EventsArg = {
      filter: () => {},
      action: (event, handler) => {
        actions.set(event, handler)
      },
      schedule: () => {},
      init: () => {},
      embed: () => {},
    }
    const tools = buildHookTools<Schema>(events, {
      database: {},
      services: {},
      getSchema: async () => ({}),
      logger: logger as unknown as ContextArg['logger'],
    })
    tools.afterCreate('files', async () => {
      throw new Error('notify failed')
    })
    await expect(actions.get('files.items.create')!({ keys: ['1'] }, { accountability: null })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'files.items.create' }),
      expect.stringContaining('action handler failed'),
    )
  })
})
