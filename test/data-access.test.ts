// data-access runtime 測試：
// - service 工廠 key ↔ collection 名反推（Pascal 吃掉底線後 regex 無損不了，須靠 schema 真實 collection 名比對）
// - transaction 的 knex 解析優先序（顯式 trx > scope trx > top-level）

import realKnex from 'knex'
import { describe, expect, it } from 'vitest'

import { createDataAccess } from '../src/data-access/access.js'
import { collectionToServiceKey, serviceKeyToCollection } from '../src/data-access/directus-services.js'

import type { Knex } from 'knex'

describe('serviceKeyToCollection', () => {
  it('有 schema collection 名時無損還原（含數字段 / 單字母段）', () => {
    const collections = ['file_tags', 'user_2fa', 'a_b_c']
    expect(serviceKeyToCollection('FileTagsService', collections)).toBe('file_tags')
    expect(serviceKeyToCollection('User2faService', collections)).toBe('user_2fa')
    expect(serviceKeyToCollection('ABCService', collections)).toBe('a_b_c')
  })

  it('forward key 與型別層 Pascal 對齊', () => {
    expect(collectionToServiceKey('file_tags')).toBe('FileTagsService')
    expect(collectionToServiceKey('user_2fa')).toBe('User2faService')
    expect(collectionToServiceKey('a_b_c')).toBe('ABCService')
  })

  it('無 schema 時退回 regex 盡力反推（單字段仍正確）', () => {
    expect(serviceKeyToCollection('FileTagsService')).toBe('file_tags')
    expect(serviceKeyToCollection('ArticlesService')).toBe('articles')
  })

  // Pascal 非單射，靜默取第一個會讓寫入落到哪張表由 Object.keys 順序決定、跨環境可能不同
  it('多張表對到同一工廠名 → throw，不賭順序', () => {
    expect(() => serviceKeyToCollection('PrivateService', ['private', '_private']))
      .toThrow(/對應到多張表/)
    expect(() => serviceKeyToCollection('ABService', ['a_b', 'a__b']))
      .toThrow(/對應到多張表/)
  })
})

describe('transaction 的 knex 解析', () => {
  interface Schema {
    files: { id: string }[];
  }

  /** 假 knex：每次開交易都產生帶新名字的 trx，名字即可讀出解析結果與巢狀層數 */
  function makeKnex(name: string, log: string[]): Knex {
    return {
      __name: name,
      transaction: async (fn: (trx: Knex) => Promise<unknown>) => {
        log.push(name)
        return fn(makeKnex(`${name}>trx`, log))
      },
    } as unknown as Knex
  }

  function setup() {
    const log: string[] = []
    const seen: string[] = []
    const access = createDataAccess<Schema>({
      knex: makeKnex('root', log),
      services: {
        ItemsService: class {
          constructor(_collection: string, options: { knex: { __name: string } }) {
            seen.push(options.knex.__name)
          }

          async readByQuery() {
            return []
          }
        },
      },
      getSchema: async () => ({}),
      logger: console as unknown as Parameters<typeof createDataAccess>[0]['logger'],
    })
    // log 記開交易的 base、seen 記 ItemsService 實際收到的連線
    return { access, log, seen }
  }

  it('交易外的 items() 走 top-level 連線', async () => {
    const { access, seen } = setup()
    await access.items('files').readByQuery({})
    expect(seen).toEqual(['root'])
  })

  it('交易體內的 items() 自動綁到 trx（免逐處傳）', async () => {
    const { access, seen } = setup()
    await access.transaction(async () => {
      await access.items('files').readByQuery({})
    })
    expect(seen).toEqual(['root>trx'])
  })

  it('巢狀 transaction 以外層 trx 為 base（即 savepoint、非另一條獨立交易）', async () => {
    const { access, log, seen } = setup()
    await access.transaction(async () => {
      await access.transaction(async () => {
        await access.items('files').readByQuery({})
      })
    })
    expect(log).toEqual(['root', 'root>trx'])
    expect(seen).toEqual(['root>trx>trx'])
  })

  it('顯式 trx 優先於 scope 與 top-level', async () => {
    const { access, seen } = setup()
    const explicit = { __name: 'explicit' } as unknown as Knex
    await access.transaction(async () => {
      await access.items('files', { trx: explicit }).readByQuery({})
    })
    expect(seen).toEqual(['explicit'])
  })

  it('交易體回傳值原樣透傳', async () => {
    const { access } = setup()
    await expect(access.transaction(async () => 42)).resolves.toBe(42)
  })

  it('tools.knex 同樣吃 scope 的交易（否則交易體內會走另一條連線、等自己鎖住的 row）', async () => {
    const { access, seen } = setup()
    const asName = (k: unknown) => (k as { __name: string }).__name
    expect(asName(access.knex)).toBe('root')
    await access.transaction(async () => {
      expect(asName(access.knex)).toBe('root>trx')
      // 對照組：items() 與 knex 兩條路徑不得有落差
      await access.items('files').readByQuery({})
    })
    expect(seen).toEqual(['root>trx'])
    expect(asName(access.knex)).toBe('root')
  })
})

// 這些 key 由引擎與 log 序列化主動探測，回 async function 會讓它們真的去建構 service
describe('lazy service proxy 的探測 key', () => {
  function setupLazy() {
    const constructed: string[] = []
    const access = createDataAccess<{ files: { id: string }[] }>({
      knex: {} as unknown as Knex,
      services: {
        ItemsService: class {
          constructor(collection: string) {
            constructed.push(collection)
          }

          async readByQuery() {
            return []
          }
        },
      },
      getSchema: async () => ({}),
      logger: console as unknown as Parameters<typeof createDataAccess>[0]['logger'],
    })
    return { access, constructed }
  }

  it('序列化與字串化不觸發 service 建構（logger.info({ ctx }) 會走這條）', () => {
    const { access, constructed } = setupLazy()
    const svc = access.items('files')
    expect(JSON.stringify({ svc })).toBe('{}')
    expect(String(svc)).toBe('[directus-typed-kit lazy service]')
    expect(`${svc}`).toBe('[directus-typed-kit lazy service]')
    expect(constructed).toEqual([])
  })

  it('await 同步取得的 proxy 不會永久 pending（then 恆為 undefined）', async () => {
    const { access, constructed } = setupLazy()
    await expect(Promise.resolve(access.items('files'))).resolves.toBeDefined()
    expect(constructed).toEqual([])
  })

  it('呼叫底層不存在的方法 → 明確 TypeError，不是 undefined is not a function', async () => {
    const { access } = setupLazy()
    const svc = access.items('files') as unknown as { nope: () => Promise<void> }
    await expect(svc.nope()).rejects.toThrow(/沒有方法 "nope"/)
  })
})

// knex 實例是 function 又掛滿方法，Proxy 的 apply / get 轉發必須連鏈式查詢與子物件都不破
describe('tools.knex 的 Proxy 不破壞真實 knex 介面', () => {
  function setupReal() {
    const base = realKnex({ client: 'pg' })
    const access = createDataAccess<{ files: { id: string; name: string }[] }>({
      knex: base,
      services: {},
      getSchema: async () => ({}),
      logger: console as unknown as Parameters<typeof createDataAccess>[0]['logger'],
    })
    return { access, base }
  }

  it('callable 與鏈式查詢', async () => {
    const { access, base } = setupReal()
    const sql = (access.knex as unknown as Knex)('files').where({ id: 1 }).select('name').toString()
    expect(sql).toContain('select "name" from "files"')
    await base.destroy()
  })

  it('raw / schema / transaction 等既有介面原樣可用', async () => {
    const { access, base } = setupReal()
    const k = access.knex as unknown as Knex
    expect(k.raw('select 1').toString()).toContain('select 1')
    expect(typeof k.transaction).toBe('function')
    expect(typeof k.schema.createTable).toBe('function')
    expect(k.client.constructor.name).toBeTruthy()
    await base.destroy()
  })
})
