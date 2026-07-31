// hook domain 型別測試（vitest --typecheck）：KitSchema 註冊（createHook / createEndpoint 免帶泛型即推導）、
// before* 省略 handler 的純 middleware gate 多載（after* 不提供）

import { body } from 'directus-typed-kit'
import { createEndpoint } from 'directus-typed-kit/endpoint'
import { createHook, definePermission, validate } from 'directus-typed-kit/hook'
import { describe, expectTypeOf, it } from 'vitest'

import type { Timestamp } from '../src/schema/dates.js'
import type { Accountability, Guard, StandardSchemaV1, TypedItemsService } from 'directus-typed-kit'
import type { Application } from 'express'

// KitSchema：註冊一次專案 Schema，驗證 createHook / createEndpoint 免帶泛型即推導
// 此 augmentation 為全域、只能宣告一次，故收斂於 hook 測試（唯一用到註冊值的 domain）
declare module 'directus-typed-kit' {
  interface KitSchema {
    schema: Schema;
  }
}

// 僅保留斷言所需欄位：collection key、payload deep-write（m2o / o2m / 日期）
interface Folder {
  id: string;
  name: string;
  parent: string | Folder | null;
}
interface FileTag {
  id: string;
  file: string | FileRow;
  label: string;
}
interface FileRow {
  id: string;
  created_at: Timestamp | null;
  folder: string | Folder | null; // m2o
  tags: string[] | FileTag[]; // o2m
}
interface Schema {
  files: FileRow[];
  folders: Folder[];
  file_tags: FileTag[];
}

describe('KitSchema 註冊：createHook / createEndpoint 免帶泛型', () => {
  it('createHook 的 tools 依註冊的 Schema 推導（items / beforeCreate 收斂為 Schema collection）', () => {
    createHook((tools) => {
      expectTypeOf(tools.items('files')).toEqualTypeOf<TypedItemsService<Schema, 'files'>>()
      // collection 參數限縮為註冊 Schema 的 key
      expectTypeOf(tools.beforeCreate).parameter(0).toEqualTypeOf<'files' | 'folders' | 'file_tags'>()
    })
  })

  it('beforeCreate payload 為 deep-write 形狀（filter 在 PayloadService 前、即 createOne 原始輸入）', () => {
    createHook((tools) => {
      tools.beforeCreate('files', (payload) => {
        // 關聯收 FK 或巢狀 partial、日期 string，皆免 cast
        expectTypeOf<{ folder: { name: string } }>().toMatchTypeOf<typeof payload>()
        expectTypeOf<{ tags: [string, { label: string }] }>().toMatchTypeOf<typeof payload>()
        expectTypeOf<{ created_at: string }>().toMatchTypeOf<typeof payload>()
      })
    })
  })

  it('createEndpoint 的 tools 同樣依註冊 Schema 推導', () => {
    createEndpoint((tools) => {
      expectTypeOf(tools.items('folders')).toEqualTypeOf<TypedItemsService<Schema, 'folders'>>()
    })
  })

  it('外部模組的 guard 免帶 Schema 泛型即吃註冊值', () => {
    const guard: Guard<{ hit: true }> = (ctx) => {
      expectTypeOf(ctx.items('files')).toEqualTypeOf<TypedItemsService<Schema, 'files'>>()
      return { hit: true }
    }
    createEndpoint(({ route }) => {
      route.get('/x', { guards: [guard] }, (ctx) => {
        expectTypeOf(ctx.hit).toEqualTypeOf<true>()
      })
    })
  })

  it('仍可顯式帶泛型覆寫註冊值', () => {
    interface Other { widgets: { id: string }[] }
    createHook<Other>((tools) => {
      expectTypeOf(tools.beforeCreate).parameter(0).toEqualTypeOf<'widgets'>()
    })
  })

  // 內建 guard 的 ctx 綁 RouteContext<S> 的話會被逆變釘死在註冊 Schema 上，
  // 覆寫泛型時整組 guards 不 assignable、連帶吃掉同陣列其他 guard 的 extras
  it('覆寫泛型後內建 guard 仍可用，且不影響同陣列其他 guard 的 extras', () => {
    interface Other { widgets: { id: string }[] }
    const schema = {} as StandardSchemaV1<unknown, { n: number }>
    createEndpoint<Other>((tools) => {
      tools.route.post('/x', {
        guards: [body(schema), async (ctx) => ({ token: ctx.params.token! })],
      }, (ctx) => {
        expectTypeOf(ctx.body).toEqualTypeOf<{ n: number }>()
        expectTypeOf(ctx.token).toEqualTypeOf<string>()
        expectTypeOf(ctx.items('widgets')).toEqualTypeOf<TypedItemsService<Other, 'widgets'>>()
      })
    })
  })
})

describe('after* 的 meta.payload 依 Schema 推導（與 before* 同待遇）', () => {
  it('afterCreate 的 payload 為該 collection 的 deep-write 形狀', () => {
    createHook((tools) => {
      tools.afterCreate('files', (meta) => {
        expectTypeOf(meta.payload.created_at).toEqualTypeOf<string | null | undefined>()
        expectTypeOf(meta.keys).toEqualTypeOf<string[]>()
      })
    })
  })
})

describe('handler context 的兩視角（before* 帶事件交易、after* 不帶）', () => {
  it('before* 的 ctx.database 為 Schema 綁定 knex（非 any、非原生 Knex）', () => {
    createHook((tools) => {
      tools.beforeUpdate('files', async (_payload, _meta, ctx) => {
        const row = await ctx.database('files').select('created_at').first()
        // 走事件交易但視角同 tools.knex：timestamp → Date
        expectTypeOf(row?.created_at).toEqualTypeOf<Date | null | undefined>()
        // @ts-expect-error 型別非 any，不存在的欄位仍報錯
        void row?.__definitely_not_a_column
      })
    })
  })

  it('beforeDelete 與 filter 逃生口的 ctx 同樣帶 database', () => {
    createHook((tools) => {
      tools.beforeDelete('files', (_keys, _meta, ctx) => {
        expectTypeOf(ctx.database('file_tags')).not.toBeNever()
      })
      tools.filter('items.read', (_payload, _meta, ctx) => {
        expectTypeOf(ctx.database('files')).not.toBeNever()
      })
    })
  })

  it('after* 的 ctx 不給 database（該連線等同 tools.knex，且已在交易外）', () => {
    createHook((tools) => {
      tools.afterUpdate('files', (_meta, ctx) => {
        expectTypeOf(ctx.accountability).toEqualTypeOf<Accountability | null>()
        // @ts-expect-error action ctx 刻意不含 database
        void ctx.database
      })
    })
  })
})

describe('before* 省略 handler 多載（純 middleware gate）', () => {
  it('before* 可只給 middleware 陣列、免 handler', () => {
    createHook((tools) => {
      tools.beforeCreate('files', [definePermission(() => true)])
      tools.beforeUpdate('files', [definePermission(() => true)])
      tools.beforeDelete('files', [definePermission(() => true)])
    })
  })

  it('after* 不提供此形式：middleware-only 應型別錯誤（寫入後 handler 才是本體）', () => {
    createHook((tools) => {
      // @ts-expect-error afterCreate 無 middleware-only 多載
      tools.afterCreate('files', [definePermission(() => true)])
    })
  })
})

describe('授權 gate 只掛得上 before* / filter', () => {
  const schema = {} as StandardSchemaV1<unknown, { n: number }>

  it('after* 帶 gate → 型別錯（事件觸發時已 commit，throw 擋不下任何東西）', () => {
    createHook((tools) => {
      // @ts-expect-error definePermission 不可掛 afterCreate
      tools.afterCreate('files', [definePermission(() => true)], () => {})
      // @ts-expect-error definePermission 不可掛 afterUpdate
      tools.afterUpdate('files', [definePermission(() => true)], () => {})
      // @ts-expect-error definePermission 不可掛 afterDelete
      tools.afterDelete('files', [definePermission(() => true)], () => {})
    })
  })

  it('action 逃生口（屬 after）同樣擋下', () => {
    createHook((tools) => {
      // @ts-expect-error definePermission 不可掛 action
      tools.action('files.items.create', [definePermission(() => true)], () => {})
    })
  })

  it('非授權型 middleware（validate）在 after* 照常可用', () => {
    createHook((tools) => {
      tools.afterCreate('files', [validate(schema)], () => {})
      tools.action('files.items.create', [validate(schema)], () => {})
    })
  })

  it('before* / filter 仍接受 gate', () => {
    createHook((tools) => {
      tools.beforeCreate('files', [definePermission(() => true)], () => {})
      tools.filter('items.read', [definePermission(() => true)], () => {})
    })
  })
})

describe('init 依事件推出 typed meta', () => {
  it('routes / app / middlewares 系列 meta.app 為 Express Application', () => {
    createHook((tools) => {
      tools.init('routes.before', (meta) => {
        expectTypeOf(meta.app).toEqualTypeOf<Application>()
      })
    })
  })

  it('cli 系列 meta.program 為 unknown（無對應 @types）', () => {
    createHook((tools) => {
      tools.init('cli.before', (meta) => {
        expectTypeOf(meta.program).toEqualTypeOf<unknown>()
      })
    })
  })

  it('未知 init 事件應型別錯誤', () => {
    createHook((tools) => {
      // @ts-expect-error 'foo.bar' 不在 InitEvent union
      tools.init('foo.bar', () => {})
    })
  })
})

describe('beforeRoutes / afterRoutes', () => {
  it('beforeRoutes：req.accountability 必有（免 ?.）、內層 user 仍可 null', () => {
    createHook((tools) => {
      tools.beforeRoutes('/files', (req) => {
        expectTypeOf(req.accountability).toEqualTypeOf<Accountability>()
        expectTypeOf(req.accountability.user).toEqualTypeOf<string | null>()
      })
      // 省略 path → app 全域
      tools.beforeRoutes((req) => {
        expectTypeOf(req.accountability).toEqualTypeOf<Accountability>()
      })
    })
  })

  it('afterRoutes：error handler（err-first），accountability optional，參數免標即推斷', () => {
    createHook((tools) => {
      tools.afterRoutes((err, req, _res, _next) => {
        expectTypeOf(err).toEqualTypeOf<unknown>()
        expectTypeOf(req.accountability).toEqualTypeOf<Accountability | null | undefined>()
      })
      // 給 path 形式（首參 string 區分，不靠 arity，故不影響推斷）
      tools.afterRoutes('/x', (err, req) => {
        expectTypeOf(err).toEqualTypeOf<unknown>()
        expectTypeOf(req.accountability).toEqualTypeOf<Accountability | null | undefined>()
      })
    })
  })
})

describe('逃生口 filter / action 純 middleware（對稱同 before / after）', () => {
  it('filter（屬 before）可只給 middleware 陣列、免 handler', () => {
    createHook((tools) => {
      tools.filter('auth.login', [definePermission(() => true)])
    })
  })

  it('action（屬 after）不提供此形式：middleware-only 應型別錯誤', () => {
    createHook((tools) => {
      // @ts-expect-error action 無 middleware-only 多載（寫入後 handler 才是本體）
      tools.action('files.items.create', [definePermission(() => true)])
    })
  })
})
