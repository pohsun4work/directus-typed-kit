# directus-typed-kit

[![npm](https://img.shields.io/npm/v/directus-typed-kit)](https://www.npmjs.com/package/directus-typed-kit)
[![license](https://img.shields.io/npm/l/directus-typed-kit)](./LICENSE)

為 Directus 的 **hook / endpoint** extension 補上完整型別。註冊一次專案 Schema，hook payload、`ItemsService`、knex 查詢結果就全程 typed。runtime 100% 沿用原生 `defineHook` / `defineEndpoint`，kit 只加型別與組合便利層。

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

### Schema 契約

`Schema` 自行定義（手寫或由 generator 產出後轉換），kit 只要求四件事：

| 契約 | 寫法 | 為什麼 |
| --- | --- | --- |
| 容器 | `collection: Row[]`，singleton 用裸 `Row` | collection key 即 `items()` / `knex()` 的表名 |
| 關聯 | m2o 寫 `string \| Row`、o2m 寫 `string[] \| Row[]` | 讀取展開與否由 `fields` 決定，兩種形狀都要在型別裡；kit 也靠「有沒有 FK 那半」把關聯與 `json` 欄位分開，o2m 漏寫 `string[]` 會被當成 json |
| nullable | `field: T \| null`（不用 `field?: T`） | 讀取結果欄位恆在、值才可能 null；optional 會多帶假的 `undefined` |
| 日期 / conceal | 標 brand（下方範例） | 同一欄位在 items 與 knex 兩視角型別不同，kit 靠 brand 分流 |

```ts
import type { Concealed, DateOnly, Timestamp } from 'directus-typed-kit'

interface Article {
  id: string;
  title: string;
  body: string | null;
  published_on: DateOnly | null; // API 回 'YYYY-MM-DD'、knex 回 Date
  created_at: Timestamp; // API 回 ISO 帶 Z、knex 回 Date
  author: string | Author | null; // m2o：未展開是 FK、展開是 row
  tags: string[] | ArticleTag[]; // o2m：FK 在 child 表，故 knex 視角無此欄
  meta: Record<string, unknown> | null; // json：無 FK 那半故非關聯，兩視角都原樣
}
interface Author {
  id: string;
  name: string;
  password: Concealed; // items 讀出是遮蔽字串故型別上移除，要真值改走 knex
}
interface ArticleTag { id: string; article: string | Article; label: string }

export interface Schema {
  articles: Article[];
  authors: Author[];
  site_settings: { id: string; project_name: string }; // singleton：裸 row、非陣列
}
```

日期 brand 有 `Timestamp`（UTC）、`DateTime`（無時區）、`DateOnly`、`TimeOnly` 四種，差別只在 knex 視角：前三者為 `Date`，`TimeOnly` 為 `string`（node-pg 把 time 當字串）。

系統表（`directus_*`）不內建於 Schema：`services.UsersService()` 等內建 service 開箱可用，要 typed 的 `items('directus_users')` / `knex('directus_files')` 則自行把需要的表加進 Schema 或 `KnexOverrides`。

## Hook

以時序命名對應原生事件，middleware 可組合：

```ts
import { createHook, validate } from 'directus-typed-kit/hook'

export default createHook(({ beforeCreate, afterUpdate, items, logger }) => {
  // payload 自動 typed 為 Partial<Schema['share_links']>；不回傳 → 沿用原 payload
  beforeCreate('share_links', [requireShare, validate(ShareSchema)], async (payload) => {
    payload.password_hash = hashPassword(payload.password_hash as string)
  })

  // ItemsService 完整 typed：結果依 fields 收斂，巢狀點記逐層推導
  afterUpdate('files', async ({ keys }) => {
    const rows = await items('files').readMany(keys, { fields: ['id', 'folder.name'] })
    for (const r of rows) logger.info({ id: r.id, folder: r.folder.name })
  })
})
```

- `beforeCreate / beforeUpdate / beforeDelete` → 原生 filter；`afterCreate / afterUpdate / afterDelete` → 原生 action
- 其他事件用 `filter(event, …)` / `action(event, …)`；`schedule / init / embed` 直通原生
- before\* 的第三參數 `ctx` 帶 `database`——**本次 mutation 的交易**，查得到尚未 commit 的變更（參照完整性檢查須用它）。handler 內的 `items()` / `services` / `transaction()` 也自動落在該交易，不必逐處傳
- after\* 的 ctx 沒有 `database`：action 事件在交易 commit 後才 emit，已無交易可用。**在 after\* 裡寫入失敗不會回滾原 mutation**，需要原子性就寫在 before\*

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

guard ctx 與 handler ctx 一樣自帶存取器，故「查參與者」「驗擁有權」這類資料型授權可寫成可重用 guard、不必降級成 handler 內 helper：

```ts
export const loadParticipant: Guard<{ participant: Participant }> = async ({ knex, params, accountability }) => {
  const row = await knex('participants').where({ match: params.id, user: accountability?.user }).first()
  if (!row) throw new NotParticipantError()
  return { participant: row } // 型別累加進 handler ctx
}
```

## 資料存取

hook 與 endpoint 的 tools 都帶 Schema 綁定的存取器，全部 typed：`items('files')`、`services.XxxService()`、`knex('files')`（保留名如 `FilesService` / `AssetsService` 對應 Directus 內建特化 service）。

同一欄位在 service 與 knex 兩視角型別不同，各自對齊 runtime 實際回傳的值：

- **conceal 欄位**（password / token…）：service **讀取**視角移除（讀出是遮蔽字串），要真值改走 `knex`；**寫入**視角保留為純 `string`（建帳號、hook 內雜湊密碼都用得到）
- **日期欄位**：items / SDK 視角是 `string`，knex 視角是 `Date`（`time` 兩邊皆 `string`）

`fields` 與 `sort` 都吃巢狀點記（`folder.parent.name`、`sort: ['-folder.name']`），結果型別逐層推導。點記深度上限為三段——自參照關聯（`parent: Folder`）否則會無限遞迴，且候選 union 隨層數指數成長。

typed knex 的保障範圍是**取回的 row 有型別**（`row.nope` 會報錯），不含查詢條件：`where({ nope: 1 })`、`select('nope')` 走的是 knex `QueryBuilder` 自身的 fallback overload，未知欄位不會被擋。

`services.XxxService()` 的保留名對應 Directus 內建 service，優先於同名 collection。名單為 `Assets / Files / Mail / Users / Roles / Folders / Permissions / Policies / Shares / Revisions / Activity / Settings / Notifications / Flows / Operations / Presets / Translations / Collections / Fields / Relations / Extensions`——業務表撞名時該工廠取的是內建 service，其 CRUD 請改用 `items(collection)`（kit 偵測到會 warn 一次）。

`transaction` 開的交易同樣 Schema 綁定（原生 `knex.transaction` 的 trx 沒有這條簽章、整串查詢會塌成 `any`）：

```ts
await transaction(async (trx) => {
  // trx 與 knex 同樣 typed，且體內的 items() / services / knex 自動落在同一交易
  const row = await trx('matches').where({ id }).forUpdate().first()
  await items('matches').updateOne(id, { state_seq: row!.state_seq + 1 })
})
```

`knex` 與 `items()` / `services` 一樣吃當前 scope 的交易（`transaction()` 開的、或 before\* 事件的），不會另開一條連線去等自己鎖住的 row。

巢狀 `transaction()` 開的是 savepoint，在 before\* hook 內呼叫則接在事件交易上。要綁到當前 scope 以外的交易（如把外部 trx 傳進無 scope 的 helper）才需要 `items(c, { trx })`。

## 兩軸權限

| 軸線 | 問題 | 用法 |
| --- | --- | --- |
| 執行身分 | query 用什麼身分跑 | `items(c, { as })` / `service(Ctor, { as })`，`as: 'admin' \| 'system' \| 'caller'`（預設 caller） |
| 授權 | 呼叫者准不准做 | `definePermission(check, { message })`（middleware，admin 與 system 自動放行） |

`as: 'caller'` 在沒有事件 / 請求 scope 時（`schedule`、或被丟出 async context 的 callback）退為**匿名**身分，不是 `null`——`null` 在 Directus 是 system、繞過全部 ACL。要 system 權限請顯式寫 `{ as: 'system' }`。

`validate(schema)` 的 parsed 結果會**疊回**原 payload 而非取代，故 schema 只列要驗的欄位即可，未列的不會被 zod / valibot 的預設 strip 洗掉。
