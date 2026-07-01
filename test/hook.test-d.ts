// hook domain 型別測試（vitest --typecheck）：KitSchema 註冊（createHook / createEndpoint 免帶泛型即推導）、
// before* 省略 handler 的純 middleware gate 多載（after* 不提供）

import { createEndpoint } from 'directus-typed-kit/endpoint'
import { createHook, definePermission } from 'directus-typed-kit/hook'
import { describe, expectTypeOf, it } from 'vitest'

import type { Timestamp } from '../src/schema/dates.js'
import type { Accountability, TypedItemsService } from 'directus-typed-kit'
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

  it('仍可顯式帶泛型覆寫註冊值', () => {
    interface Other { widgets: { id: string }[] }
    createHook<Other>((tools) => {
      expectTypeOf(tools.beforeCreate).parameter(0).toEqualTypeOf<'widgets'>()
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
