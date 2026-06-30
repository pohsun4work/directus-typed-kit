// kit runtime 測試：before* 省略 handler 時的純 gate 行為
// definePermission 是 throw-or-pass 的 middleware，本身即完整語意；省略 handler 時 build 補 no-op 收尾
// 驗證無 handler 下 gate 仍正確擋下 / 放行，且放行時 payload 原樣回傳（沿用 auto-return）

import { describe, expect, it, vi } from 'vitest'

import { contextStore } from '../src/core/context.js'
import { ForbiddenError } from '../src/core/errors.js'
import { buildHookTools } from '../src/hook/build.js'
import { definePermission } from '../src/hook/middleware.js'

import type { Accountability } from '../src/core/types.js'
import type { ServiceAs } from '../src/data-access/directus-services.js'

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

  it('\'caller\'（預設）無 context store → null', async () => {
    const { resolve } = setupItems()
    await expect(resolve('caller')).resolves.toBeNull()
  })
})
