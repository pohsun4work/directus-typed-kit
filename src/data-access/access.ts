// DataAccess 的 runtime 實作
// 執行身分收斂在 resolveAccountability（as 各值語義見 core/types 的 Identity）
// items() / services 同步回傳 lazy proxy，schema 折進本就 await 的方法裡 lazy 取、不 stale

import { contextStore } from '../core/context.js'
import { collectionToServiceKey, serviceKeyToCollection, SPECIAL_SERVICE_NAMES } from './directus-services.js'

import type { Accountability, Logger, SchemaOverview } from '../core/types.js'
import type { AccessOptions, ServiceAs, ServiceFactories } from './directus-services.js'
import type { SchemaShape } from './typed-items.js'
import type { DataAccess, SchemaKnex, SchemaTrx, ServiceCtor } from './types.js'
import type { Knex } from 'knex'

interface DataAccessDeps {
  knex: Knex;
  /** Directus 注入的 services 容器（含 ItemsService / FilesService…） */
  services: Record<string, unknown>;
  getSchema: () => Promise<SchemaOverview>;
  logger: Logger;
}

type AnyMethods = Record<string, (...a: unknown[]) => unknown>

// lazy proxy 的 fallback 目標：引擎與 log 序列化會探 toJSON / toString / valueOf 這類 key，
// 全部回 async function 會讓它們真的去建構 service（logger.info({ ctx }) 就踩得到），
// 且錯誤落在沒人接的 promise 上；這些 key 改由本物件與其 prototype 接手
const LAZY_PROBE_FALLBACK = {
  toJSON: () => undefined,
  toString: () => '[directus-typed-kit lazy service]',
}

export function createDataAccess<S extends SchemaShape>(deps: DataAccessDeps): DataAccess<S> {
  const { knex, services: injected, getSchema, logger } = deps

  // 合成身分的預設底：admin 預設 false，要繞 ACL 須顯式給 true 避免手滑誤繞權限
  // 無 request 來源故 roles / ip 為空
  const ANON_BASE: Accountability = { user: null, role: null, roles: [], admin: false, app: false, ip: null }

  const resolveAccountability = (as: ServiceAs): Accountability | null => {
    // 物件形式吃 Partial：補滿必填欄，呼叫端只給關心的欄位（如 { admin: true, user }）
    if (typeof as !== 'string')
      return { ...ANON_BASE, ...as }
    switch (as) {
      case 'admin':
        return { ...ANON_BASE, admin: true }
      case 'system':
        return null
      case 'caller':
      default: {
        // 無 scope（schedule、被丟出 async context 的 callback）時退匿名而非 null
        // null 在 Directus 是 system＝繞過全部 ACL，拿它當預設身分的 fallback 等於失敗方向朝 allow
        const scope = contextStore.getStore()
        return scope ? scope.accountability : ANON_BASE
      }
    }
  }

  // hook 走 event context 的 schema（已就緒、不 stale），endpoint / schedule 無則 await getSchema()
  const resolveSchema = async (): Promise<SchemaOverview> => {
    const scope = contextStore.getStore()
    if (scope?.schema)
      return scope.schema
    const schema = await getSchema()
    // 回填 scope：endpoint 一個 handler 內多次 items() 否則每次都重跑 getSchema()
    if (scope)
      scope.schema = schema
    return schema
  }

  // 在方法呼叫時才解析（同 resolveSchema），註冊期取會錯過之後才進的 transaction scope
  const resolveKnex = (trx?: Knex): Knex => trx ?? contextStore.getStore()?.knex ?? knex

  // 共用 lazy proxy：方法被呼叫（皆 async）時才取 schema、由 build() 建構底層 service 實例
  const lazyService = (
    build: (schema: SchemaOverview, accountability: Accountability | null) => AnyMethods,
    as: ServiceAs,
  ): AnyMethods =>
    new Proxy(LAZY_PROBE_FALLBACK as unknown as AnyMethods, {
      get(target, method) {
        // then 必回 undefined：否則 proxy 成 thenable，await 同步的 services.Foo() 時會對 proxy 取 then
        // 觸發假 service 建構且 resolve/reject 永不被呼叫，該 await 永久 pending
        if (typeof method !== 'string' || method === 'then')
          return undefined
        if (method in target)
          return Reflect.get(target, method)
        return async (...args: unknown[]) => {
          const schema = await resolveSchema()
          const accountability = resolveAccountability(as)
          const built = build(schema, accountability)
          const fn = built[method]
          if (typeof fn !== 'function')
            throw new TypeError(`directus-typed-kit: 底層 Directus service 沒有方法 "${method}"`)
          return fn.apply(built, args)
        }
      },
    })

  // ctor 簽章斷言集中一次：newItemsService 與 servicesProxy 共用
  const ItemsService = injected.ItemsService as new (
    collection: string,
    options: { knex: Knex; accountability: Accountability | null; schema: SchemaOverview },
  ) => AnyMethods

  const newItemsService = (
    collection: string,
    schema: SchemaOverview,
    accountability: Accountability | null,
    trx?: Knex,
  ): AnyMethods => new ItemsService(collection, { knex: resolveKnex(trx), accountability, schema })

  const items = ((collection: string, opts?: AccessOptions) =>
    lazyService(
      (schema, accountability) => newItemsService(collection, schema, accountability, opts?.trx),
      opts?.as ?? 'caller',
    )) as unknown as DataAccess<S>['items']

  // 保留名一律優先於同名 collection，而 SpecialServiceTypes 的回傳型別寬鬆不會報錯
  // 業務表叫 notifications / users / settings 時會靜默讀寫到 directus_* 系統表，故 warn 一次
  const shadowWarned = new Set<string>()
  const warnIfShadowing = (key: string, schema: SchemaOverview): void => {
    if (shadowWarned.has(key))
      return
    shadowWarned.add(key)
    const collections = (schema as { collections?: Record<string, unknown> }).collections
    const shadowed = collections && Object.keys(collections).find((c) => collectionToServiceKey(c) === key)
    if (shadowed) {
      logger.warn(
        `directus-typed-kit: services.${key}() 取的是 Directus 內建 service，不是 collection "${shadowed}"；該表請改用 items('${shadowed}')`,
      )
    }
  }

  // services.XxxService({ as }) 工廠 proxy：
  //   - 保留名（FilesService / AssetsService…）→ 用真實注入的同名 class 建構（不帶 collection）
  //   - 其餘 → 由工廠名反推 collection、走 ItemsService(collection)
  const servicesProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string')
        return undefined
      return (opts?: AccessOptions) => {
        const as = opts?.as ?? 'caller'
        return lazyService((schema, accountability) => {
          if (SPECIAL_SERVICE_NAMES.has(key)) {
            warnIfShadowing(key, schema)
            const Ctor = injected[key] as (new (o: { knex: Knex; accountability: Accountability | null; schema: SchemaOverview }) => AnyMethods) | undefined
            if (!Ctor)
              throw new Error(`directus-typed-kit: Directus service "${key}" is not available in this context`)
            return new Ctor({ knex: resolveKnex(opts?.trx), accountability, schema })
          }
          // 拿 schema 真實 collection 名做無損反推（Pascal 吃掉的底線 regex 補不回）
          const collections = (schema as { collections?: Record<string, unknown> }).collections
          return newItemsService(
            serviceKeyToCollection(key, collections && Object.keys(collections)),
            schema,
            accountability,
            opts?.trx,
          )
        }, as)
      }
    },
  }) as unknown as ServiceFactories<S>

  const service = (async <T>(Ctor: ServiceCtor<T>, opts?: AccessOptions): Promise<T> => {
    const as = opts?.as ?? 'caller'
    const schema = await resolveSchema()
    const accountability = resolveAccountability(as)
    return new Ctor({ knex: resolveKnex(opts?.trx), accountability, schema })
  }) as DataAccess<S>['service']

  const transaction = (<T>(fn: (trx: SchemaTrx<S>) => Promise<T>): Promise<T> => {
    // 進入時取（非 transaction callback 內），不賭 AsyncLocalStorage 穿得過 knex 內部的 async 邊界
    const scope = contextStore.getStore()
    // base 取 scope 的 trx 才能讓巢狀呼叫落成 savepoint，trx 再回存 scope 供體內 items() 自動同交易
    return (scope?.knex ?? knex).transaction((trx) =>
      contextStore.run({ ...scope, accountability: scope?.accountability ?? null, knex: trx }, () => fn(trx as unknown as SchemaTrx<S>)))
  }) as DataAccess<S>['transaction']

  // knex 同樣吃 scope 的交易：只有它綁死註冊期連線的話，transaction() 體內用 tools.knex
  // 會走另一條連線 —— 看不到本交易未 commit 的變更，還可能等在自己鎖住的 row 上死鎖
  const scopedKnex = new Proxy(knex, {
    apply: (_target, _thisArg, args: unknown[]) =>
      (resolveKnex() as unknown as (...a: unknown[]) => unknown)(...args),
    get: (_target, prop) => {
      const active = resolveKnex()
      const value = Reflect.get(active, prop) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(active) : value
    },
  }) as unknown as SchemaKnex<S>

  return {
    items,
    services: servicesProxy,
    service,
    knex: scopedKnex,
    transaction,
    getSchema,
  }
}
