# directus-typed-kit

[![npm](https://img.shields.io/npm/v/directus-typed-kit)](https://www.npmjs.com/package/directus-typed-kit)
[![license](https://img.shields.io/npm/l/directus-typed-kit)](./LICENSE)

為 Directus 的 **hook / endpoint** extension 補上完整型別。註冊一次專案 Schema，hook payload、`ItemsService`、knex 查詢就全程 typed。runtime 100% 沿用原生 `defineHook` / `defineEndpoint`，kit 只加型別與組合便利層。

## 安裝

```bash
npm i directus-typed-kit
```

`@directus/extensions-sdk`、`@directus/errors`、`@directus/types`、`knex` 為 peerDependencies，由宿主 extension 提供。

## 註冊 Schema

把專案 Schema 註冊一次，`createHook` / `createEndpoint` 就免逐次帶泛型。放進一個由 tsconfig `include` 納入的 `.d.ts`：

```ts
// src/directus-typed-kit.d.ts
import type { Schema } from './schema' // 你的 collection 型別

declare module 'directus-typed-kit' {
  interface KitSchema { schema: Schema }
  // interface KitTypes { PrimaryKey: string }
}

export {} // 勿刪
```

> `Schema` 自行定義
> 若用 `directus-extension-ts-typegen` 或 `directus-extension-generate-types` 產生，`adapters/` 下有對應 adapter 轉成 kit 形狀。

## Hook

以時序命名對應原生事件，middleware 可組合：

```ts
import { createHook, validate } from 'directus-typed-kit/hook'

export default createHook(({ beforeCreate, afterUpdate, items, logger }) => {
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

- `beforeCreate / beforeUpdate / beforeDelete` → 原生 filter；`afterCreate / afterUpdate / afterDelete` → 原生 action
- 其他事件用 `filter(event, …)` / `action(event, …)`；`schedule / init / embed` 直通原生

## Endpoint

route + guards，回傳值即 response：

```ts
import { body, createEndpoint, reply } from 'directus-typed-kit/endpoint'

export const shareEndpoint = createEndpoint(({ route, knex }) => {
  // guard 回傳物件會 merge 進 ctx 且型別累加：handler 拿到 typed ctx.link
  route.get('/:token', { guards: [loadLinkGuard] }, async ({ link }) => loadMetadata(knex, link))

  route.post('/:token/auth', { guards: [loadLinkGuard, body(AuthBody)] }, async ({ body, link }) => {
    if (!verifyPassword(body.password, link.password_hash))
      throw createError('UNAUTHORIZED', 'Invalid', 401)()
    return issueSession(link) // 一般值 → res.json(200)
  })

  route.delete('/:token', { guards: [loadLinkGuard] }, async ({ link }) => reply(204))
})
```

guard（`body` / `query` / `params`）與 hook 的 `validate` 都吃 Standard Schema，實作（zod / valibot / arktype）自選。

## 資料存取

hook 與 endpoint 的 tools 都帶 Schema 綁定的存取器，全部 typed：`items('files')`、`services.XxxService()`、`knex('files')`（保留名如 `FilesService` / `AssetsService` 對應 Directus 內建特化 service）。

同一欄位在 service 與 knex 兩視角型別不同，各自對齊 runtime 實際回傳的值：

- **conceal 欄位**（password / token…）：service 讀出是遮蔽字串，故型別上移除；要真值改走 `knex`
- **日期欄位**：items / SDK 視角是 `string`，knex 視角是 `Date`（`time` 兩邊皆 `string`）

## 兩軸權限

| 軸線 | 問題 | 用法 |
| --- | --- | --- |
| 執行身分 | query 用什麼身分跑 | `items(c, { as })` / `service(Ctor, { as })`，`as: 'admin' \| 'system' \| 'caller'`（預設 caller） |
| 授權 | 呼叫者准不准做 | `definePermission(check, { message })`（middleware，admin 自動放行） |
