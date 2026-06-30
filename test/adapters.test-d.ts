// adapters domain 型別測試（vitest --typecheck）：各用本地 raw schema、自包含
// ts-typegen（"datetime" literal → brand、系統表 enrichment）與 generate-types（僅標 conceal、日期不 brand）兩適配器

import { describe, expectTypeOf, it } from 'vitest'

import type { SchemaKnex } from '../src/data-access/types.js'
import type { KnexView, Timestamp } from '../src/schema/dates.js'
import type { CollectionItem, TypedItemsService } from 'directus-kit'
import type { FromGenerateTypes } from 'directus-kit/adapters/generate-types'
import type { FromTsTypegen } from 'directus-kit/adapters/ts-typegen'

describe('FromTsTypegen 系統表 enrichment（適配器灌入、core 不認得系統表）', () => {
  // 原始 ts-typegen 產出：系統表只含自訂欄位（singleton），自訂 collection 為 Row[]、日期為 "datetime"
  interface RawSchema {
    articles: { id: string; title: string }[];
    directus_users: { quota_override_bytes: number | null };
  }
  type Mapped = FromTsTypegen<RawSchema>

  const usersSvc = {} as TypedItemsService<Mapped, 'directus_users'>
  const k = {} as SchemaKnex<Mapped>

  it('service 視角：補上核心欄位（email）+ 自訂欄位（quota_override_bytes）', async () => {
    const [u] = await usersSvc.readByQuery({ fields: ['email', 'quota_override_bytes'] })
    expectTypeOf(u!).toEqualTypeOf<{ email: string | null; quota_override_bytes: number | null }>()
  })

  it('service 視角：conceal（password）排除、不可選取', async () => {
    // @ts-expect-error password 由適配器標 conceal brand → service 視角排除
    await usersSvc.readByQuery({ fields: ['password'] })
  })

  it('knex 視角：conceal（password）還原真值 string、核心欄位齊', async () => {
    const row = await k('directus_users').select('password', 'email').first()
    expectTypeOf(row?.password).toEqualTypeOf<string | null | undefined>()
    expectTypeOf(row?.email).toEqualTypeOf<string | null | undefined>()
  })

  it('knex 視角：不在 raw schema 的系統表（directus_files）也補上，日期為 Date', async () => {
    const row = await k('directus_files').select('filesize', 'uploaded_on').first()
    expectTypeOf(row?.filesize).toEqualTypeOf<string | null | undefined>()
    expectTypeOf(row?.uploaded_on).toEqualTypeOf<Date | undefined>()
  })
})

describe('FromGenerateTypes 適配器（自包含、僅標 conceal、日期不 brand）', () => {
  // generate-types 風格：root 全表 Row[]、系統表已含完整欄位、日期純 string、optional 用 `?`
  interface DirectusUsersRaw {
    id: string;
    email?: string | null;
    password?: string | null; // conceal
    token?: string | null; // conceal
    last_access?: string | null; // 日期但純 string（無 marker）
    quota_override_bytes?: number | null; // 自訂欄位（已併入產物）
  }
  interface CustomDirectusTypes {
    articles: { id: string; title: string }[];
    directus_users: DirectusUsersRaw[];
  }
  type Mapped = FromGenerateTypes<CustomDirectusTypes>

  const usersSvc = {} as TypedItemsService<Mapped, 'directus_users'>
  const k = {} as SchemaKnex<Mapped>

  it('service 視角：核心(email)+自訂(quota_override_bytes)在，conceal 排除', async () => {
    const [u] = await usersSvc.readByQuery({ fields: ['email', 'quota_override_bytes'] })
    // 適配器已去 optional → 欄位恆在、值可能 null（與 ts-typegen 一致，無 undefined）
    expectTypeOf(u!.email).toEqualTypeOf<string | null>()
    expectTypeOf(u!.quota_override_bytes).toEqualTypeOf<number | null>()
  })

  it('service 視角：conceal(password)不可選取', async () => {
    // @ts-expect-error password 標 conceal brand → service 排除
    await usersSvc.readByQuery({ fields: ['password'] })
  })

  it('knex 視角：conceal(password)還原真值 string', async () => {
    const row = await k('directus_users').select('password').first()
    expectTypeOf(row?.password).toEqualTypeOf<string | null | undefined>()
  })

  it('日期未標 Temporal → 兩視角皆 string（預設）', async () => {
    const row = await k('directus_users').select('last_access').first()
    expectTypeOf(row?.last_access).toEqualTypeOf<string | null | undefined>()
  })

  it('版本參數：顯式 0.6.1 與預設（Latest）結果一致', () => {
    expectTypeOf<FromGenerateTypes<CustomDirectusTypes, '0.6.1'>>().toEqualTypeOf<Mapped>()
  })

  it('Temporal 標記 → knex 視角得 Date、service read strip 成 string', async () => {
    type MappedT = FromGenerateTypes<CustomDirectusTypes, '0.6.1', {
      directus_users: { last_access: 'timestamp' };
    }>
    const kT = {} as SchemaKnex<MappedT>
    const usersSvcT = {} as TypedItemsService<MappedT, 'directus_users'>

    const row = await kT('directus_users').select('last_access').first()
    expectTypeOf(row?.last_access).toEqualTypeOf<Date | null | undefined>()

    const [u] = await usersSvcT.readByQuery({ fields: ['last_access'] })
    expectTypeOf(u!.last_access).toEqualTypeOf<string | null>()
  })

  it('Overrides 明確型別：覆寫 generate-types typed 不準的欄位（csv → array）', async () => {
    type MappedO = FromGenerateTypes<CustomDirectusTypes, '0.6.1', {
      articles: { title: ('a' | 'b')[] };
    }>
    const svc = {} as TypedItemsService<MappedO, 'articles'>
    const [a] = await svc.readByQuery({ fields: ['title'] })
    // 明確型別逐字採用（覆寫掉 generate-types 原本的 string）
    expectTypeOf(a!.title).toEqualTypeOf<('a' | 'b')[]>()
  })

  it('第二參數直接給 Overrides（省略版本＝Latest）等同顯式帶版本', () => {
    type ShortHand = FromGenerateTypes<CustomDirectusTypes, { directus_users: { last_access: 'timestamp' } }>
    type Explicit = FromGenerateTypes<CustomDirectusTypes, '0.6.1', { directus_users: { last_access: 'timestamp' } }>
    expectTypeOf<ShortHand>().toEqualTypeOf<Explicit>()
  })
})

describe('FromTsTypegen 適配器', () => {
  // ts-typegen 原始產出形狀：日期皆為字面量 "datetime"、關聯為 PK | Row、容器為 Row[] / singleton
  interface RawFile {
    id: string;
    created_at: 'datetime' | null;
    accessed_at: 'datetime';
    folder: string | RawFolder | null;
  }
  interface RawFolder {
    id: string;
    name: string;
  }
  interface RawSettings {
    id: string;
    updated_at: 'datetime' | null;
  }
  interface RawSchema {
    files: RawFile[];
    folders: RawFolder[];
    settings: RawSettings; // singleton（非陣列）
  }

  type Mapped = FromTsTypegen<RawSchema>

  it('"datetime" literal → Timestamp brand（保留 | null）', () => {
    expectTypeOf<CollectionItem<Mapped, 'files'>['created_at']>().toEqualTypeOf<Timestamp | null>()
    expectTypeOf<CollectionItem<Mapped, 'files'>['accessed_at']>().toEqualTypeOf<Timestamp>()
  })

  it('singleton 容器也被處理', () => {
    expectTypeOf<CollectionItem<Mapped, 'settings'>['updated_at']>().toEqualTypeOf<Timestamp | null>()
  })

  it('非日期欄位（關聯 / 純量）原樣穿透', () => {
    expectTypeOf<CollectionItem<Mapped, 'files'>['folder']>().toEqualTypeOf<string | RawFolder | null>()
    expectTypeOf<CollectionItem<Mapped, 'files'>['id']>().toEqualTypeOf<string>()
  })

  it('time 欄位以 Overrides 修正（knex view 為 string 而非 Date）', () => {
    interface RawWithTime { id: string; at: 'datetime' }
    interface S { rows: RawWithTime[] }
    type M = FromTsTypegen<S, '0.6.0', { rows: { at: 'time' } }>
    // time brand 的 knex view 是 string
    expectTypeOf<KnexView<CollectionItem<M, 'rows'>>['at']>().toEqualTypeOf<string>()
    // 對照：未 override 的 datetime → Timestamp → knex view 為 Date
    type MDefault = FromTsTypegen<S>
    expectTypeOf<KnexView<CollectionItem<MDefault, 'rows'>>['at']>().toEqualTypeOf<Date>()
  })
})
