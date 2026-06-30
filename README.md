# directus-typed-kit

把 Directus extension 的重複樣板抽成與 collection 無關的泛用層。`Schema`（ts-typegen 產物）一次注入，
全程有型別。runtime 100% 沿用原生（ItemsService / knex / defineHook / defineEndpoint），kit 只補型別、
正規化、組合與權限收斂；不重寫 runtime。

範圍：**hook + endpoint 兩種 API 擴充**。

## 初始化

`Schema`（ts-typegen 產物）用 module augmentation 註冊**一次**，`createHook` / `createEndpoint` 的泛型即預設取它，之後各 entry 直接從子路徑 import、免逐次帶 `<Schema>` 也免本地 wrapper。註冊放在一個 `.d.ts`，靠 tsconfig `include` 納入程式即全域生效：

```ts
// src/directus-typed-kit.d.ts
import type { Schema } from './generated/schema' // ts-typegen 產物

declare module 'directus-typed-kit' {
  interface KitSchema { schema: Schema }
  // interface KitTypes { PrimaryKey: string } // 主鍵都是 uuid 時覆寫，省去回傳值 as string
}

export {} // 標記本檔為 module（augmentation 必要，勿刪）
```

> ⚠ 這個 `.d.ts` 必須是 **module** 才會被當作 module augmentation 與 kit 介面合併；底部 `export {}` 就是明確的 module 標記。若整檔無任何頂層 import/export 變成 global script，`declare module` 會降為 ambient module 宣告而不合併 → 註冊失效、collection 收斂 `never`、`beforeCreate('files', …)` 直接型別錯誤（也因此漏註冊不會靜默放寬）。

之後每個 entry 直接 `import { createHook } from 'directus-typed-kit/hook'` / `import { createEndpoint } from 'directus-typed-kit/endpoint'`（子路徑各自獨立 → 只引入 hook 的 entry 不牽連 endpoint runtime 圖，treeshake）。需要時仍可 `createHook<別的Schema>(...)` 逐次覆寫。

## Hook（時序命名 + 可組合 middleware）

```ts
import { createHook, validate } from 'directus-typed-kit/hook'

export default createHook(({ beforeCreate, afterUpdate, items, knex, logger }) => {
  // payload 自動 typed 為 Partial<Schema['share_links']>；不回傳 → 沿用原 payload
  beforeCreate('share_links', [requireShare, validate(ShareSchema)], async (payload) => {
    payload.password_hash = hashPassword(payload.password_hash as string)
  })

  // ItemsService 完整 typed：結果依 fields 收斂、含一層巢狀關聯
  afterUpdate('files', async ({ keys }) => {
    const rows = await items('files').readMany(keys, { fields: ['id', 'folder.name'] })
    for (const r of rows) logger.info({ id: r.id, folder: r.folder.name })
  })
})
```

- `beforeCreate / beforeUpdate / beforeDelete` → 原生 filter；`afterCreate / afterUpdate / afterDelete` → 原生 action。
- 非 items / system 事件用逃生口 `filter(event, …)` / `action(event, …)`（保留全名）。
- `schedule / init / embed` 直通原生。

## Endpoint（route + guards + Standard Schema）

```ts
import { body, createEndpoint, RAW, reply } from 'directus-typed-kit/endpoint'

export const shareEndpoint = createEndpoint(({ route, services, knex }) => {
  // guard 回傳物件 merge 進 ctx 且型別累加：handler 拿到 typed ctx.link
  route.get('/:token', { guards: [loadLinkGuard] }, async ({ link }) => loadMetadata(knex, link))

  route.post('/:token/auth', { guards: [loadLinkGuard, body(AuthBody)] }, async ({ body, link }) => {
    if (!verifyPassword(body.password, link.password_hash))
      throw createError('UNAUTHORIZED', 'Invalid', 401)()
    return issueSession(link) // plain value → res.json(200)
  })

  route.get('/:token/download', { guards: [loadLinkGuard] }, async ({ link, res }) => {
    await streamBinary(services.AssetsService({ as: 'system' }), link.file, res)
    return RAW // streaming：自己寫 res、回傳 RAW
  })

  route.delete('/:token', { guards: [loadLinkGuard] }, async ({ link }) => reply(204))
})
```

## 兩軸權限（勿混）

| 軸線 | 問題 | 入口 |
| --- | --- | --- |
| 執行身分 | query 用什麼身分跑 | `items(c, { as })` / `service(Ctor, { as })`，`as: 'admin' \| 'system' \| 'caller'`（預設 caller） |
| 授權 | 呼叫者准不准做 | `definePermission(check, { message })`（middleware，admin 自動放行） |

## 建置

```bash
npm run build      # tsdown → dist（各子路徑各一 entry，treeshake）
npm run typecheck  # tsc --noEmit
npm test           # vitest --typecheck（型別測試）
```

`@directus/extensions-sdk`、`@directus/errors` 為 peerDependencies，由宿主 extension 提供。
Standard Schema 實作（zod / valibot / arktype）由使用者自選，kit 只依賴 `StandardSchemaV1` 介面。
