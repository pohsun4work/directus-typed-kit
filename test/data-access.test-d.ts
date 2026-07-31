// data-access domain 型別測試（vitest --typecheck）：service 與 knex 兩視角的型別正確性
// service 視角：fields→result 投影、default read、Filter、寫入 payload（deep-write）、conceal 排除、ServiceFactories
// knex 視角：KnexView（兩視角差異）、SchemaKnex（raw knex 依 Schema typed）

import { describe, expectTypeOf, it } from 'vitest'

import type { ServiceFactories, ServiceFactory } from '../src/data-access/directus-services.js'
import type { Filter } from '../src/data-access/typed-items.js'
import type { DataAccess, SchemaKnex } from '../src/data-access/types.js'
import type { Concealed } from '../src/schema/conceal.js'
import type { KnexView, Timestamp } from '../src/schema/dates.js'
import type { CollectionItem, TypedItemsService } from 'directus-typed-kit'
import type { Knex } from 'knex'

// KnexOverrides 逃生口：登錄一張非 SDK 的自訂 raw 表（系統表已由 kit 內建、不需登錄）
declare module 'directus-typed-kit' {
  interface KnexOverrides {
    my_raw_table: { id: string; payload: string | null };
  }
}

// kit contract 的 Schema：日期標 date brand、conceal 欄標 Concealed、nullable 用 `T | null`
interface Folder {
  id: string;
  name: string;
  parent: string | Folder | null;
}
interface FileRow {
  id: string;
  display_name: string;
  size_bytes: number;
  created_at: Timestamp | null;
  secret: Concealed | null; // conceal 欄位（service 排除、knex 還原 string）
  folder: string | Folder | null; // m2o（nullable）
  tags: string[] | FileTag[]; // o2m
}
interface FileTag {
  id: string;
  file: string | FileRow;
  label: string;
}
interface Schema {
  files: FileRow[];
  folders: Folder[];
  file_tags: FileTag[];
}

declare const files: TypedItemsService<Schema, 'files'>

describe('CollectionItem', () => {
  it('解陣列容器取單筆 row 型別', () => {
    expectTypeOf<CollectionItem<Schema, 'files'>>().toEqualTypeOf<FileRow>()
  })

  it('optional 欄位去 optional 並剝 undefined（讀取結果欄位恆在、值可能 null）', () => {
    interface OptionalSchema {
      rows: { id: string; note?: string | null }[];
      settings: { id: string; label?: string | null }; // singleton 容器同樣正規化
    }
    expectTypeOf<CollectionItem<OptionalSchema, 'rows'>>().toEqualTypeOf<{ id: string; note: string | null }>()
    expectTypeOf<CollectionItem<OptionalSchema, 'settings'>>().toEqualTypeOf<{ id: string; label: string | null }>()
  })

  it('optional 欄位在明列 fields 與星號兩條讀取路徑上型別一致', async () => {
    interface OptionalSchema { rows: { id: string; note?: string | null }[] }
    const rows = {} as TypedItemsService<OptionalSchema, 'rows'>
    const [listed] = await rows.readByQuery({ fields: ['note'] })
    const [starred] = await rows.readByQuery({ fields: ['*'] })
    expectTypeOf(listed!.note).toEqualTypeOf<string | null>()
    expectTypeOf(starred!.note).toEqualTypeOf<string | null>()
  })
})

describe('fields→result 投影', () => {
  it('明列關聯點記 folder.name → { name } | null（保留 m2o 的 null）', async () => {
    const r = await files.readByQuery({ fields: ['id', 'folder.name'] })
    expectTypeOf(r).toEqualTypeOf<{ id: string; folder: { name: string } | null }[]>()
  })

  it('直接選關聯欄位 → 收斂為 FK', async () => {
    const r = await files.readByQuery({ fields: ['id', 'folder'] })
    expectTypeOf(r).toEqualTypeOf<{ id: string; folder: string | null }[]>()
  })

  it('o2m 點記 tags.label → 陣列保留', async () => {
    const r = await files.readByQuery({ fields: ['id', 'tags.label'] })
    expectTypeOf(r).toEqualTypeOf<{ id: string; tags: { label: string }[] }[]>()
  })

  it('星號展開 *.* → 關聯展開一層、m2o 保留 null 且無假空分支', async () => {
    const r = await files.readByQuery({ fields: ['*.*'] })
    // folder 展開成 Folder（parent 收 FK）| null，不含多餘的 {} 空分支
    expectTypeOf(r[0]!.folder).toEqualTypeOf<{ id: string; name: string; parent: string | null } | null>()
  })

  it('無 fields → default read：日期 strip 成 string、關聯收 FK', async () => {
    const [r] = await files.readByQuery({ limit: 1 })
    expectTypeOf(r!).toEqualTypeOf<{
      id: string;
      display_name: string;
      size_bytes: number;
      created_at: string | null;
      folder: string | null;
      tags: string[];
    }>()
  })
})

describe('Filter', () => {
  it('純量欄位 operator', () => {
    expectTypeOf<{ size_bytes: { _gt: number } }>().toMatchTypeOf<Filter<FileRow>>()
  })
  it('關聯可比 FK，也可遞迴進關聯 row', () => {
    expectTypeOf<{ folder: { _eq: string } }>().toMatchTypeOf<Filter<FileRow>>()
    expectTypeOf<{ folder: { name: { _eq: string } } }>().toMatchTypeOf<Filter<FileRow>>()
  })
  it('_and / _or 邏輯組合', () => {
    expectTypeOf<{ _and: [{ size_bytes: { _gte: number } }] }>().toMatchTypeOf<Filter<FileRow>>()
  })
})

describe('寫入 payload（deep-write：日期 strip、關聯收 FK 或巢狀 partial）', () => {
  it('createOne 接受 created_at 為 ISO string，回傳 PK（本專案覆寫為 string 也相容預設）', () => {
    type Payload = Parameters<typeof files.createOne>[0]
    expectTypeOf<{ created_at: string }>().toMatchTypeOf<Payload>()
    // 日期欄位不需 cast 成 brand（nullable 欄位連帶允許 null）
    expectTypeOf<Payload['created_at']>().toEqualTypeOf<string | null | undefined>()
  })

  it('m2o 關聯：可塞 FK 字串，也可塞巢狀 partial（deep-create，免 cast 全 Row）', () => {
    type Payload = Parameters<typeof files.createOne>[0]
    expectTypeOf<{ folder: string }>().toMatchTypeOf<Payload>()
    expectTypeOf<{ folder: { name: string } }>().toMatchTypeOf<Payload>()
  })

  it('o2m 關聯：陣列元素逐筆可混 FK 與巢狀 partial', () => {
    type Payload = Parameters<typeof files.createOne>[0]
    expectTypeOf<{ tags: string[] }>().toMatchTypeOf<Payload>()
    expectTypeOf<{ tags: { label: string }[] }>().toMatchTypeOf<Payload>()
    expectTypeOf<{ tags: [string, { label: string }] }>().toMatchTypeOf<Payload>()
  })
})

describe('conceal brand（core 泛型，generator 無關）', () => {
  it('service 視角：conceal 欄位（secret）不可選取', async () => {
    // @ts-expect-error secret 是 conceal 欄位，service 視角排除
    await files.readByQuery({ fields: ['secret'] })
  })

  it('service 預設讀取不含 conceal 欄位', async () => {
    const [r] = await files.readByQuery({ limit: 1 })
    // @ts-expect-error secret 不在 service 視角
    void r!.secret
  })
})

describe('ServiceFactories 工廠 key', () => {
  it('一般 collection → 自動產生工廠（TypedItemsService）', () => {
    expectTypeOf<ServiceFactories<Schema>['FileTagsService']>()
      .toEqualTypeOf<ServiceFactory<TypedItemsService<Schema, 'file_tags'>>>()
  })
  it('撞到內建特化名（FilesService / FoldersService）→ 讓位給特化 service，非 TypedItemsService', () => {
    expectTypeOf<ServiceFactories<Schema>['FilesService']>()
      .not
      .toEqualTypeOf<ServiceFactory<TypedItemsService<Schema, 'files'>>>()
  })
})

describe('KnexView（knex 視角與 service 不同）', () => {
  it('timestamp → Date、conceal → string（還原真值）、m2o → FK、o2m → 移除（FK 在 child 表）、純量原樣', () => {
    expectTypeOf<KnexView<FileRow>>().toEqualTypeOf<{
      id: string;
      display_name: string;
      size_bytes: number;
      created_at: Date | null;
      secret: string | null;
      folder: string | null;
    }>()
  })
})

describe('SchemaKnex（raw knex 依 Schema / KnexOverrides typed）', () => {
  const k = {} as SchemaKnex<Schema>

  it('已知 Schema 表 → select 後 first 收斂為對應欄位（knex 視角）', async () => {
    const row = await k('files').select('size_bytes', 'created_at').first()
    expectTypeOf(row?.size_bytes).toEqualTypeOf<number | undefined>()
    // knex 視角：timestamp → Date（非 service 的 brand string）
    expectTypeOf(row?.created_at).toEqualTypeOf<Date | null | undefined>()
  })

  it('存取不存在欄位報錯（證明非 any fallback）', async () => {
    const row = await k('files').first()
    // @ts-expect-error files 無此欄位
    void row?.__definitely_not_a_column
  })

  it('o2m 欄位（tags）不在 knex 視角（FK 在 child 表、select 取不到）', async () => {
    const row = await k('files').first()
    // @ts-expect-error tags 是 o2m，parent 表無此欄
    void row?.tags
  })

  it('conceal 欄位（secret）→ knex 視角還原真值 string', async () => {
    const row = await k('files').select('secret').first()
    expectTypeOf(row?.secret).toEqualTypeOf<string | null | undefined>()
  })

  it('KnexOverrides 逃生口：登錄非 SDK 的自訂 raw 表', async () => {
    const row = await k('my_raw_table').select('payload').first()
    expectTypeOf(row?.payload).toEqualTypeOf<string | null | undefined>()
  })

  it('未知表名（如 alias）落回 Knex 原簽章、仍可用（untyped）', () => {
    // 'x as y' 等 alias 非 Schema key → 落回 Knex fallback 簽章照常可查，
    // 故 Schema-aware 是「加成」而非「限制」，不破壞既有 raw / alias 查詢
    expectTypeOf(k('articles as a')).not.toBeNever()
  })

  it('保留 Knex 原介面（raw / transaction / schema），仍可賦值給 Knex', () => {
    expectTypeOf(k).toMatchTypeOf<Knex>()
    expectTypeOf(k.transaction).not.toBeNever()
  })
})

describe('SchemaTrx（交易內查詢與 SchemaKnex 同樣 typed）', () => {
  const access = {} as DataAccess<Schema>

  it('交易體的 trx 帶 Schema-aware 簽章（原生 Knex.Transaction 會塌成 any）', async () => {
    const size = await access.transaction(async (trx) => {
      const row = await trx('files').select('size_bytes', 'created_at').first()
      expectTypeOf(row?.created_at).toEqualTypeOf<Date | null | undefined>()
      // @ts-expect-error 型別非 any，不存在的欄位仍報錯
      void row?.__definitely_not_a_column
      return row?.size_bytes
    })
    // 回傳值型別透傳，不被 Promise<any> 吃掉
    expectTypeOf(size).toEqualTypeOf<number | undefined>()
  })

  it('保留 Knex.Transaction 介面（commit / rollback / savepoint）', async () => {
    await access.transaction(async (trx) => {
      expectTypeOf(trx).toMatchTypeOf<Knex.Transaction>()
    })
  })

  it('items() 可綁到 kit 沒開的交易（如 hook 事件交易）', () => {
    const trx = {} as Knex
    expectTypeOf(access.items('files', { trx })).toEqualTypeOf<TypedItemsService<Schema, 'files'>>()
    expectTypeOf(access.items('files', { as: 'admin', trx })).toEqualTypeOf<TypedItemsService<Schema, 'files'>>()
  })
})

describe('json 欄位（純物件、無 FK 那半 → 非關聯，兩視角都原樣保留）', () => {
  interface JsonRow {
    id: string;
    meta_rec: Record<string, unknown>;
    meta_obj: { foo: string };
    meta_obj_null: { foo: string } | null;
    meta_arr: { a: number }[];
    meta_unknown_arr: unknown[];
  }
  interface JsonSchema { rows: JsonRow[] }
  const rows = {} as TypedItemsService<JsonSchema, 'rows'>

  it('service 預設讀取原樣保留（不被 FkOf 收成 never）', async () => {
    const [r] = await rows.readByQuery({})
    expectTypeOf(r!).toEqualTypeOf<{
      id: string;
      meta_rec: Record<string, unknown>;
      meta_obj: { foo: string };
      meta_obj_null: { foo: string } | null;
      meta_arr: { a: number }[];
      meta_unknown_arr: unknown[];
    }>()
  })

  it('明列 fields 同樣原樣保留', async () => {
    const [r] = await rows.readByQuery({ fields: ['meta_rec', 'meta_arr'] })
    expectTypeOf(r!).toEqualTypeOf<{ meta_rec: Record<string, unknown>; meta_arr: { a: number }[] }>()
  })

  it('json 不是關聯，故無 rel.field 這種假 API 面', async () => {
    // @ts-expect-error meta_rec 是 json 欄位，不可點記選子欄位
    await rows.readByQuery({ fields: ['meta_rec.anything'] })
  })

  it('knex 視角保留 json 欄位（DB 就是一欄，select 取得到）', () => {
    expectTypeOf<KnexView<JsonRow>>().toEqualTypeOf<{
      id: string;
      meta_rec: Record<string, unknown>;
      meta_obj: { foo: string };
      meta_obj_null: { foo: string } | null;
      meta_arr: { a: number }[];
      meta_unknown_arr: unknown[];
    }>()
  })

  it('對照組：csv 陣列（元素為純量）仍走 DB 逗號字串', () => {
    expectTypeOf<KnexView<{ tags: string[] }>['tags']>().toEqualTypeOf<string>()
  })
})

// any 對每道 Extract 都算出 any，不特別擋就會被判成 conceal（讀取視角整欄消失）或關聯
describe('Schema 寫 any 的欄位（兩視角都原樣保留、不靜默消失）', () => {
  interface AnySchema { rows: { id: string; loose: any; keep: string }[] }

  it('service 讀取視角保留該欄', async () => {
    const rows = {} as TypedItemsService<AnySchema, 'rows'>
    const [r] = await rows.readByQuery({})
    expectTypeOf(r!).toEqualTypeOf<{ id: string; loose: any; keep: string }>()
  })

  it('knex 視角保留該欄（不被收成 string）', () => {
    expectTypeOf<KnexView<{ id: string; loose: any }>>().toEqualTypeOf<{ id: string; loose: any }>()
  })
})

describe('conceal 欄位的讀寫兩視角', () => {
  it('寫入視角保留欄位並脫 brand（建帳號要給 password，遮蔽只發生在讀取）', () => {
    type Payload = Parameters<typeof files.createOne>[0]
    expectTypeOf<{ secret: string }>().toMatchTypeOf<Payload>()
    expectTypeOf<Payload['secret']>().toEqualTypeOf<string | null | undefined>()
  })

  it('讀取視角仍排除（值非真值，逼呼叫端改走 raw knex）', async () => {
    const [r] = await files.readByQuery({ limit: 1 })
    // @ts-expect-error secret 不在 service 讀取視角
    void r!.secret
  })
})

describe('星號混明列點記（同鍵不得撞成 FK & 展開 row 的假交集）', () => {
  it('fields: [\'*\', \'folder.name\'] → folder 由點記那半接管', async () => {
    const [r] = await files.readByQuery({ fields: ['*', 'folder.name'] })
    expectTypeOf(r!.folder).toEqualTypeOf<{ name: string } | null>()
    // 其餘欄位仍由星號供給
    expectTypeOf(r!.display_name).toEqualTypeOf<string>()
  })

  it('動態 fields（union 含 \'*\' 與點記）同樣不塌成 string & {…}', async () => {
    const dynamic: readonly ('id' | 'folder.name' | '*')[] = ['*']
    const [r] = await files.readByQuery({ fields: dynamic })
    expectTypeOf(r!.folder).toEqualTypeOf<{ name: string } | null>()
  })
})

describe('Schema 帶 readonly / 日期陣列', () => {
  it('readonly modifier 不傳染進寫入 payload（hook 內 payload.x = v 是主流寫法）', () => {
    interface ReadonlySchema { rows: { readonly id: string; readonly status: string }[] }
    type Payload = Parameters<TypedItemsService<ReadonlySchema, 'rows'>['createOne']>[0]
    const payload = {} as Payload
    payload.status = 'x'
    expectTypeOf<Payload>().toEqualTypeOf<{ id?: string; status?: string }>()
  })

  it('日期陣列欄位遞迴剝 brand（讀寫都是純字串）', () => {
    interface DateArraySchema { rows: { id: string; slots: Timestamp[] }[] }
    type Payload = Parameters<TypedItemsService<DateArraySchema, 'rows'>['createOne']>[0]
    expectTypeOf<Payload['slots']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<{ slots: string[] }>().toMatchTypeOf<Payload>()
  })
})

describe('singleton 與 upsert 方法', () => {
  it('singleton 容器（裸 Row）可用 readSingleton / upsertSingleton', async () => {
    interface SingletonSchema { site_settings: { id: string; title: string } }
    const settings = {} as TypedItemsService<SingletonSchema, 'site_settings'>
    const current = await settings.readSingleton({ fields: ['title'] })
    expectTypeOf(current).toEqualTypeOf<Partial<{ title: string }>>()
    expectTypeOf(settings.upsertSingleton).not.toBeNever()
  })

  it('upsert / updateBatch / getKeysByQuery 皆 typed', async () => {
    expectTypeOf(await files.getKeysByQuery({ limit: 1 })).toEqualTypeOf<string[]>()
    expectTypeOf(await files.upsertOne({ display_name: 'x' })).toEqualTypeOf<string>()
    expectTypeOf(await files.updateBatch([{ id: 'a', display_name: 'x' }])).toEqualTypeOf<string[]>()
  })
})

describe('KnexView nullable 欄位（null 聯集不得誤走關聯分支）', () => {
  interface NullableRow {
    id: string;
    csv_tags: string[] | null; // nullable csv/enum：DB 存逗號字串
    meta: Record<string, unknown> | null; // 純量 JSON 物件（非關聯）
    owner: string | Folder | null; // m2o nullable
    children: string[] | FileTag[] | null; // nullable o2m（FK 在 child 表）
  }

  it('nullable csv → string | null（不塌成 null）', () => {
    expectTypeOf<KnexView<NullableRow>['csv_tags']>().toEqualTypeOf<string | null>()
  })

  it('純量 JSON 物件原樣保留（不被 m2o 判準塌成 null）', () => {
    expectTypeOf<KnexView<NullableRow>['meta']>().toEqualTypeOf<Record<string, unknown> | null>()
  })

  it('nullable m2o → FK', () => {
    expectTypeOf<KnexView<NullableRow>['owner']>().toEqualTypeOf<string | null>()
  })

  it('nullable o2m → 移除（parent 表無此欄）', () => {
    expectTypeOf<KnexView<NullableRow>>().not.toHaveProperty('children')
  })
})
