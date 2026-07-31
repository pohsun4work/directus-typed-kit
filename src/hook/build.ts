import { contextStore } from '../core/context.js'
import { createDataAccess } from '../data-access/access.js'
import { applyFilterMiddleware, GATE } from './middleware.js'

import type { Accountability, Logger, SchemaOverview } from '../core/types.js'
import type { SchemaShape } from '../data-access/typed-items.js'
import type { GetSchemaOptions, SchemaKnex } from '../data-access/types.js'
import type {
  ActionHandler,
  ActionMeta,
  DeleteHandler,
  EventContext,
  EventMeta,
  FilterContext,
  FilterHandler,
  FilterMiddleware,
  HookTools,
  MiddlewareHandler,
} from './types.js'
import type { Application } from 'express'
import type { Knex } from 'knex'

// Directus 注入的 register events 與 context（鬆散結構，邊界 cast）
interface NativeEventMeta {
  event?: string;
  collection?: string;
  keys?: (string | number)[];
  key?: string | number;
  payload?: Record<string, unknown>;
}
interface NativeEventContext {
  accountability?: unknown;
  schema?: SchemaOverview;
  /** filter 事件是本次 mutation 的交易，action 事件的只是全域連線故不外露 */
  database?: unknown;
}
interface NativeFilterEvents {
  filter: (event: string, handler: (payload: unknown, meta: NativeEventMeta, ctx: NativeEventContext) => unknown) => void;
  action: (event: string, handler: (meta: NativeEventMeta, ctx: NativeEventContext) => void) => void;
  schedule: (cron: string, handler: () => void | Promise<void>) => void;
  init: (event: string, handler: (meta: Record<string, unknown>) => void) => void;
  embed: (position: 'head' | 'body', code: string | (() => string)) => void;
}
interface NativeHookContext {
  database: unknown;
  services: Record<string, unknown>;
  getSchema: (options?: GetSchemaOptions) => Promise<SchemaOverview>;
  logger: Logger;
}

function toKeys(raw: (string | number)[] | undefined, key: string | number | undefined): string[] {
  if (raw?.length)
    return raw.map(String)
  if (key !== undefined && key !== null)
    return [String(key)]
  return []
}

/** delete 事件下 payload 直接是 keys 陣列、meta.keys 為 undefined（Directus API 不一致） */
function normalizeKeys(payload: unknown, meta: NativeEventMeta, isDelete: boolean): string[] {
  if (isDelete && Array.isArray(payload))
    return payload.map(String)
  return toKeys(meta.keys, meta.key)
}

/** 型別層已擋，此處是 cast 繞過時的第二道；擋在註冊期而非事件觸發時，訊息才指向呼叫端 */
function assertNoGate(middleware: FilterMiddleware[], event: string): void {
  if (middleware.some((m) => (m as Partial<Record<typeof GATE, true>>)[GATE]))
    throw new TypeError(`directus-typed-kit: "${event}" 的 middleware 含授權 gate，請改掛對應的 before* / filter`)
}

function makeEventMeta(meta: NativeEventMeta, event: string, collection: string, keys: string[]): EventMeta {
  return {
    event: meta.event ?? event,
    collection: meta.collection ?? collection,
    keys,
  }
}

export function buildHookTools<S extends SchemaShape>(
  events: NativeFilterEvents,
  context: NativeHookContext,
): HookTools<S> {
  const access = createDataAccess<S>({
    knex: context.database as never,
    services: context.services,
    getSchema: context.getSchema,
    logger: context.logger,
  })

  const splitArgs = <H>(
    a: FilterMiddleware[] | H,
    b?: H,
  ): { middleware: FilterMiddleware[]; handler: H | undefined } => {
    if (!Array.isArray(a)) {
      // 寫成 (collection, handler, [mw]) 會靜默丟棄整組 middleware，授權 gate 就此失效
      if (b !== undefined)
        throw new TypeError('directus-typed-kit: middleware 陣列必須放在 handler 之前')
      return { middleware: [], handler: a }
    }
    if (b !== undefined && typeof b !== 'function')
      throw new TypeError('directus-typed-kit: 第三參數必須是 handler 函式')
    return { middleware: a, handler: b }
  }

  const registerFilter = (
    event: string,
    collection: string,
    middleware: FilterMiddleware[],
    handler: FilterHandler<unknown, S> | DeleteHandler<S>,
    isDelete: boolean,
  ): void => {
    events.filter(event, async (payload, meta, ctx) => {
      const accountability = (ctx?.accountability ?? null) as EventContext['accountability']
      // 事件交易存進 scope：handler 內的 items() / transaction() 自動落在同一交易
      // 否則它們走另一條連線，看不到本次未 commit 的變更，還可能等在本交易鎖住的 row 上死鎖
      const database = ctx?.database as Knex | undefined
      return contextStore.run({ accountability, schema: ctx?.schema, knex: database }, async () => {
        const keys = normalizeKeys(payload, meta, isDelete)
        const eventMeta = makeEventMeta(meta, event, collection, keys)
        const filterCtx: FilterContext<S> = {
          accountability,
          schema: ctx?.schema,
          database: database as SchemaKnex<S>,
        }

        // middleware 跑完、進到 handler 的那份 payload：auto-return 的 fallback 取它而非最初的 payload，
        // 否則 handler 一旦不回傳（含省略 handler 的純 gate），validate 的轉換就被靜默丟棄
        let processed: unknown = payload

        // delete 無 row payload，故第一參數改給 keys，其餘 before* 才給 payload
        // cast 到 MiddlewareHandler：middleware 契約只保證 EventContext，實際傳入的是帶 database 的 filterCtx
        const base = (async (p: unknown, m: EventMeta, c: FilterContext<S>) => {
          processed = p
          if (!isDelete)
            return (handler as FilterHandler<unknown, S>)(p as Partial<unknown>, m, c)
          // keys 由 middleware 跑完的 payload 重算，meta.keys 一併對齊免得兩個參數各說各話
          // DeleteHandler 契約回 void，要改 keys 請用 middleware（其回傳值經 processed 生效）
          const deleteKeys = normalizeKeys(p, m, true)
          await (handler as DeleteHandler<S>)(deleteKeys, { ...m, keys: deleteKeys }, c)
          return undefined
        }) as MiddlewareHandler<unknown>

        const composed = applyFilterMiddleware(middleware, base)
        const out = await composed(payload as Partial<unknown>, eventMeta, filterCtx)
        return out === undefined ? processed : out
      })
    })
  }

  const registerAction = (
    event: string,
    collection: string,
    middleware: FilterMiddleware[],
    handler: ActionHandler,
  ): void => {
    assertNoGate(middleware, event)
    events.action(event, async (meta, ctx) => {
      const accountability = (ctx?.accountability ?? null) as EventContext['accountability']
      await contextStore.run({ accountability, schema: ctx?.schema }, async () => {
        const keys = toKeys(meta.keys, meta.key)
        const actionMeta: ActionMeta = {
          ...makeEventMeta(meta, event, collection, keys),
          payload: meta.payload ?? {},
        }
        const eventCtx: EventContext = { accountability, schema: ctx?.schema }
        // 原生 action 簽章是 void，Directus 收不到這個 promise：不自己接就成 unhandled rejection
        // 寫入已 commit、本來就無法回滾，錯誤只能記下來
        try {
          if (middleware.length) {
            // middleware 轉換後的 payload 回灌 handler，否則 validate 的 coerce 在 after* 會被靜默丟棄
            const base: MiddlewareHandler<unknown> = async (p, m, c) => {
              await handler({ ...(m as ActionMeta), payload: (p ?? {}) as Record<string, unknown> }, c)
            }
            const composed = applyFilterMiddleware(middleware, base)
            await composed(actionMeta.payload, actionMeta, eventCtx)
          }
          else {
            await handler(actionMeta, eventCtx)
          }
        }
        catch (err) {
          context.logger.error({ err, event: actionMeta.event }, 'directus-typed-kit: action handler failed')
        }
      })
    })
  }

  const beforeFor
    = (verb: 'create' | 'update' | 'delete') =>
      (collection: string, a: FilterMiddleware[] | FilterHandler<unknown, S> | DeleteHandler<S>, b?: FilterHandler<unknown, S> | DeleteHandler<S>): void => {
        const { middleware, handler } = splitArgs(a, b)
        registerFilter(`${collection}.items.${verb}`, collection, middleware, handler ?? (() => {}), verb === 'delete')
      }

  // after* 的 handler 即本體（無 middleware-only 語義），漏傳的話每次事件都在 commit 後才炸、訊息不指向呼叫端
  const requireHandler = <H>(handler: H | undefined, where: string): H => {
    if (typeof handler !== 'function')
      throw new TypeError(`directus-typed-kit: ${where} 缺少 handler`)
    return handler
  }

  const afterFor
    = (verb: 'create' | 'update' | 'delete') =>
      (collection: string, a: FilterMiddleware[] | ActionHandler, b?: ActionHandler): void => {
        const { middleware, handler } = splitArgs(a, b)
        registerAction(
          `${collection}.items.${verb}`,
          collection,
          middleware,
          requireHandler(handler, `after${verb[0]!.toUpperCase()}${verb.slice(1)}('${collection}')`),
        )
      }

  // 每請求包一層 contextStore（帶 req.accountability），handler 內 items({as:'caller'}) 才取得呼叫者身分
  // wrapped 的固定 arity 決定 express 分派：3 參數=一般 guard、4 參數=error handler（req 在第 2 參）
  const mountRoutes = (phase: 'routes.before' | 'routes.after') =>
    (a: unknown, b?: unknown): void => {
      const hasPath = typeof a !== 'function'
      const handler = (hasPath ? b : a) as (...args: unknown[]) => unknown
      const path = hasPath ? a : undefined
      // express 4 忽略 middleware 回傳值：async handler 的 rejection 不會進 error chain，
      // 沒接就是 unhandled rejection ＋ 該請求永遠不回應（socket 掛著）
      const scoped = (
        req: { accountability?: Accountability | null } | undefined,
        fn: () => unknown,
        next: unknown,
      ): unknown => {
        const result = contextStore.run({ accountability: req?.accountability ?? null }, fn) as
          { then?: unknown; catch?: (onRejected: (err: unknown) => void) => unknown } | undefined
        return typeof result?.then === 'function' && typeof result.catch === 'function'
          ? result.catch(next as (err: unknown) => void)
          : result
      }
      const wrapped = phase === 'routes.after'
        ? (err: unknown, req: { accountability?: Accountability | null }, res: unknown, next: unknown) =>
            scoped(req, () => handler(err, req, res, next), next)
        : (req: { accountability?: Accountability | null }, res: unknown, next: unknown) =>
            scoped(req, () => handler(req, res, next), next)
      events.init(phase, (meta) => {
        const { app } = meta as { app: Application }
        if (path === undefined)
          app.use(wrapped as never)
        else
          app.use(path as never, wrapped as never)
      })
    }

  const tools: HookTools<S> = {
    ...access,
    logger: context.logger,

    beforeCreate: beforeFor('create') as HookTools<S>['beforeCreate'],
    beforeUpdate: beforeFor('update') as HookTools<S>['beforeUpdate'],
    beforeDelete: beforeFor('delete') as HookTools<S>['beforeDelete'],
    afterCreate: afterFor('create') as HookTools<S>['afterCreate'],
    afterUpdate: afterFor('update') as HookTools<S>['afterUpdate'],
    afterDelete: afterFor('delete') as HookTools<S>['afterDelete'],

    // 逃生口不套 delete 特化：其型別已宣告 payload 原樣進、回傳值採用，
    // 套了的話 handler 收到的是 String 化的 keys、回傳值還會被丟棄（beforeDelete 才是 keys 語義那條）
    filter: ((event: string, a: FilterMiddleware[] | FilterHandler<unknown, S>, b?: FilterHandler<unknown, S>) => {
      const { middleware, handler } = splitArgs(a, b)
      registerFilter(event, '', middleware, handler ?? (() => {}), false)
    }) as HookTools<S>['filter'],

    action: ((event: string, a: FilterMiddleware[] | ActionHandler, b?: ActionHandler) => {
      const { middleware, handler } = splitArgs(a, b)
      registerAction(event, '', middleware, requireHandler(handler, `action('${event}')`))
    }) as HookTools<S>['action'],

    schedule: (cron, handler) => events.schedule(cron, handler),
    // native init 一律送 Record<string, unknown>，typed meta 由公開簽章把關，邊界 cast
    init: (event, handler) => events.init(event, handler as (meta: Record<string, unknown>) => void),
    beforeRoutes: mountRoutes('routes.before') as HookTools<S>['beforeRoutes'],
    afterRoutes: mountRoutes('routes.after') as HookTools<S>['afterRoutes'],
    embed: (position, code) => events.embed(position, code),
  }

  return tools
}
