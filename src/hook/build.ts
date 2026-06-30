// 把原生 filter/action 包成時序命名的 HookTools（beforeCreate / afterUpdate…）
// 包裝層負責：
// - 正規化 keys（吸收 native 在 create/update/delete 的不一致）
// - 套 middleware、filter 的自動 return
// - 把本次事件 scope（accountability + schema）run 進 contextStore 供 items({as:'caller'}) 讀

import { contextStore } from '../core/context.js'
import { createDataAccess } from '../data-access/access.js'
import { applyFilterMiddleware } from './middleware.js'

import type { Accountability, Logger, SchemaOverview } from '../core/types.js'
import type { SchemaShape } from '../data-access/typed-items.js'
import type {
  ActionHandler,
  ActionMeta,
  DeleteHandler,
  EventContext,
  EventMeta,
  FilterHandler,
  FilterMiddleware,
  HookTools,
} from './types.js'
import type { Application } from 'express'

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
  getSchema: () => Promise<SchemaOverview>;
  logger: Logger;
}

function toKeys(raw: (string | number)[] | undefined, key: string | number | undefined): string[] {
  if (raw?.length)
    return raw.map(String)
  if (key !== undefined && key !== null)
    return [String(key)]
  return []
}

// delete 事件下 payload 直接是 keys 陣列、meta.keys 為 undefined（Directus API 不一致）
function normalizeKeys(payload: unknown, meta: NativeEventMeta, isDelete: boolean): string[] {
  if (isDelete && Array.isArray(payload))
    return payload.map(String)
  return toKeys(meta.keys, meta.key)
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
  })

  const splitArgs = <H>(
    a: FilterMiddleware[] | H,
    b?: H,
  ): { middleware: FilterMiddleware[]; handler: H } =>
    Array.isArray(a) ? { middleware: a, handler: b as H } : { middleware: [], handler: a }

  // before* / filter 逃生口：寫入前，可改 payload / throw 擋下、自動 return
  const registerFilter = (
    event: string,
    collection: string,
    middleware: FilterMiddleware[],
    handler: FilterHandler<unknown> | DeleteHandler,
    isDelete: boolean,
  ): void => {
    events.filter(event, async (payload, meta, ctx) => {
      const accountability = (ctx?.accountability ?? null) as EventContext['accountability']
      return contextStore.run({ accountability, schema: ctx?.schema }, async () => {
        const keys = normalizeKeys(payload, meta, isDelete)
        const eventMeta = makeEventMeta(meta, event, collection, keys)
        const eventCtx: EventContext = { accountability }

        // delete：第一參數給 keys（無 row payload），其餘 before* 給 payload
        const base: FilterHandler<unknown> = isDelete
          ? async (_p, m, c) => {
            await (handler as DeleteHandler)(keys, m, c)
          }
          : (handler as FilterHandler<unknown>)

        const composed = applyFilterMiddleware(middleware, base)
        const out = await composed(payload as Partial<unknown>, eventMeta, eventCtx)
        // 自動 return：不回傳 → 沿用原 payload（delete 即 keys 陣列）
        return out === undefined ? payload : out
      })
    })
  }

  // after* / action 逃生口：寫入後副作用，無回傳
  // middleware 以 meta.payload 當 payload 套用
  const registerAction = (
    event: string,
    collection: string,
    middleware: FilterMiddleware[],
    handler: ActionHandler,
  ): void => {
    events.action(event, async (meta, ctx) => {
      const accountability = (ctx?.accountability ?? null) as EventContext['accountability']
      await contextStore.run({ accountability, schema: ctx?.schema }, async () => {
        const keys = normalizeKeys(undefined, meta, false)
        const actionMeta: ActionMeta = {
          ...makeEventMeta(meta, event, collection, keys),
          payload: meta.payload ?? {},
        }
        const eventCtx: EventContext = { accountability }
        if (middleware.length) {
          const base: FilterHandler<unknown> = async (_p, _m, c) => {
            await handler(actionMeta, c)
          }
          const composed = applyFilterMiddleware(middleware, base)
          await composed(actionMeta.payload, actionMeta, eventCtx)
        }
        else {
          await handler(actionMeta, eventCtx)
        }
      })
    })
  }

  const beforeFor
    = (verb: 'create' | 'update' | 'delete') =>
      (collection: string, a: FilterMiddleware[] | FilterHandler<unknown> | DeleteHandler, b?: FilterHandler<unknown> | DeleteHandler): void => {
        const { middleware, handler } = splitArgs(a, b)
        // 純 middleware gate（如 definePermission）可省略 handler：補 no-op 收尾，payload 原樣放行
        registerFilter(`${collection}.items.${verb}`, collection, middleware, handler ?? (() => {}), verb === 'delete')
      }

  const afterFor
    = (verb: 'create' | 'update' | 'delete') =>
      (collection: string, a: FilterMiddleware[] | ActionHandler, b?: ActionHandler): void => {
        const { middleware, handler } = splitArgs(a, b)
        registerAction(`${collection}.items.${verb}`, collection, middleware, handler)
      }

  // beforeRoutes / afterRoutes：把「init(phase, ({app}) => app.use(path?, handler))」收成一行
  // 首參為 function → 無 path、app 全域
  // 每請求包一層 contextStore（帶 req.accountability），讓 handler 內 items({as:'caller'}) 取得呼叫者身分
  // 與 before*/after* 一致（schema 省略、access 層需要時 await getSchema）
  // wrapped 的固定 arity 同時決定 express 分派：routes.before 3 參數=一般、routes.after 4 參數=error handler（req 在第 2 參）
  const mountRoutes = (phase: 'routes.before' | 'routes.after') =>
    (a: unknown, b?: unknown): void => {
      const hasPath = typeof a !== 'function'
      const handler = (hasPath ? b : a) as (...args: unknown[]) => unknown
      const path = hasPath ? a : undefined
      const scoped = (req: { accountability?: Accountability | null } | undefined, fn: () => unknown) =>
        contextStore.run({ accountability: req?.accountability ?? null }, fn)
      const wrapped = phase === 'routes.after'
        ? (err: unknown, req: { accountability?: Accountability | null }, res: unknown, next: unknown) =>
            scoped(req, () => handler(err, req, res, next))
        : (req: { accountability?: Accountability | null }, res: unknown, next: unknown) =>
            scoped(req, () => handler(req, res, next))
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

    filter: ((event: string, a: FilterMiddleware[] | FilterHandler<unknown>, b?: FilterHandler<unknown>) => {
      const { middleware, handler } = splitArgs(a, b)
      // 純 middleware gate 可省略 handler：補 no-op 收尾（同 beforeFor）
      registerFilter(event, '', middleware, handler ?? (() => {}), event.endsWith('.items.delete'))
    }) as HookTools<S>['filter'],

    action: ((event: string, a: FilterMiddleware[] | ActionHandler, b?: ActionHandler) => {
      const { middleware, handler } = splitArgs(a, b)
      registerAction(event, '', middleware, handler)
    }) as HookTools<S>['action'],

    schedule: (cron, handler) => events.schedule(cron, handler),
    // native init 一律送 Record<string, unknown>；typed meta 由公開簽章把關，邊界 cast
    init: (event, handler) => events.init(event, handler as (meta: Record<string, unknown>) => void),
    beforeRoutes: mountRoutes('routes.before') as HookTools<S>['beforeRoutes'],
    afterRoutes: mountRoutes('routes.after') as HookTools<S>['afterRoutes'],
    embed: (position, code) => events.embed(position, code),
  }

  return tools
}
