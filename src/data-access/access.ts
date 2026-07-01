// DataAccess 的 runtime 實作
// 執行身分收斂在 resolveAccountability（as 各值語義見 core/types 的 Identity）
// items() / services 同步回傳 lazy proxy，schema 折進本就 await 的方法裡 lazy 取、不 stale

import { contextStore } from '../core/context.js'
import { serviceKeyToCollection, SPECIAL_SERVICE_NAMES } from './directus-services.js'

import type { Accountability, SchemaOverview } from '../core/types.js'
import type { ServiceAs, ServiceFactories } from './directus-services.js'
import type { SchemaShape } from './typed-items.js'
import type { DataAccess, SchemaKnex, ServiceCtor } from './types.js'
import type { Knex } from 'knex'

interface DataAccessDeps {
  knex: Knex;
  /** Directus 注入的 services 容器（含 ItemsService / FilesService…） */
  services: Record<string, unknown>;
  getSchema: () => Promise<SchemaOverview>;
}

type AnyMethods = Record<string, (...a: unknown[]) => unknown>

export function createDataAccess<S extends SchemaShape>(deps: DataAccessDeps): DataAccess<S> {
  const { knex, services: injected, getSchema } = deps

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
      default:
        return contextStore.getStore()?.accountability ?? null
    }
  }

  // hook 走 event context 的 schema（已就緒、不 stale），endpoint / schedule 無則 await getSchema()
  const resolveSchema = async (): Promise<SchemaOverview> =>
    contextStore.getStore()?.schema ?? (await getSchema())

  // 共用 lazy proxy：方法被呼叫（皆 async）時才取 schema、由 build() 建構底層 service 實例
  const lazyService = (
    build: (schema: SchemaOverview, accountability: Accountability | null) => AnyMethods,
    as: ServiceAs,
  ): AnyMethods =>
    new Proxy({} as AnyMethods, {
      get(_target, method) {
        // then 必回 undefined：否則 proxy 成 thenable，await 同步的 services.Foo() 時會對 proxy 取 then
        // 觸發假 service 建構且 resolve/reject 永不被呼叫，該 await 永久 pending
        if (typeof method !== 'string' || method === 'then')
          return undefined
        return async (...args: unknown[]) => {
          const schema = await resolveSchema()
          const accountability = resolveAccountability(as)
          return build(schema, accountability)[method]!(...args)
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
  ): AnyMethods => new ItemsService(collection, { knex, accountability, schema })

  const items = ((collection: string, opts?: { as?: ServiceAs }) =>
    lazyService(
      (schema, accountability) => newItemsService(collection, schema, accountability),
      opts?.as ?? 'caller',
    )) as unknown as DataAccess<S>['items']

  // services.XxxService({ as }) 工廠 proxy：
  //   - 保留名（FilesService / AssetsService…）→ 用真實注入的同名 class 建構（不帶 collection）
  //   - 其餘 → 由工廠名反推 collection、走 ItemsService(collection)
  const servicesProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string')
        return undefined
      return (opts?: { as?: ServiceAs }) => {
        const as = opts?.as ?? 'caller'
        return lazyService((schema, accountability) => {
          if (SPECIAL_SERVICE_NAMES.has(key)) {
            const Ctor = injected[key] as (new (o: { knex: Knex; accountability: Accountability | null; schema: SchemaOverview }) => AnyMethods) | undefined
            if (!Ctor)
              throw new Error(`directus-typed-kit: Directus service "${key}" is not available in this context`)
            return new Ctor({ knex, accountability, schema })
          }
          // 拿 schema 真實 collection 名做無損反推（Pascal 吃掉的底線 regex 補不回）
          const collections = (schema as { collections?: Record<string, unknown> }).collections
          return newItemsService(
            serviceKeyToCollection(key, collections && Object.keys(collections)),
            schema,
            accountability,
          )
        }, as)
      }
    },
  }) as unknown as ServiceFactories<S>

  const service = (async <T>(Ctor: ServiceCtor<T>, opts?: { as?: ServiceAs }): Promise<T> => {
    const as = opts?.as ?? 'caller'
    const schema = await resolveSchema()
    const accountability = resolveAccountability(as)
    return new Ctor({ knex, accountability, schema })
  }) as DataAccess<S>['service']

  return {
    items,
    services: servicesProxy,
    service,
    // 真實 knex 實例，型別在邊界精修為 Schema 綁定的 SchemaKnex（callable 簽章帶 Schema 推導）
    knex: knex as unknown as SchemaKnex<S>,
    getSchema,
  }
}
