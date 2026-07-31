import type { Accountability, Logger, SchemaOverview } from '../core/types.js'
import type { CollectionItem, RegisteredSchema, SchemaShape, WritePayload } from '../data-access/typed-items.js'
import type { DataAccess, SchemaKnex } from '../data-access/types.js'
import type { Application, NextFunction, Request, Response } from 'express'

type Collection<S extends SchemaShape> = keyof S & string

export interface EventMeta {
  event: string;
  collection: string;
  /** 一律正規化為 string（Directus 各事件形狀不一），整數主鍵的表也是字串 */
  keys: string[];
}
export interface ActionMeta<T = Record<string, unknown>> extends EventMeta {
  payload: WritePayload<T>;
}
/** `schema` 是本次事件的 SchemaOverview，免再 await getSchema()\
 *  optional 對齊 Directus：其 `EventContext.schema` 為 `SchemaOverview | null`，非 items 事件常是空的
 */
export interface EventContext {
  accountability: Accountability | null;
  schema?: SchemaOverview;
}

/** `database` 是本次 mutation 的交易，查得到尚未 commit 的變更\
 *  參照完整性這類「必須看到同交易內狀態」的檢查須用它 —— 走 `tools.knex` 是另一條連線、看不到，還可能撞上被鎖的 row
 *
 * after* 的 context 不給 `database`：action 事件在交易 commit 後才 emit，Directus 給的是全域單例連線\
 * （`getDatabase()`），與 `tools.knex` 同一個實例 —— 外露只是多一個等價入口，還會讓人誤以為 after* 也在交易內
 */
export interface FilterContext<S extends SchemaShape = RegisteredSchema> extends EventContext {
  database: SchemaKnex<S>;
}

type PayloadHandler<T, Ctx> = (
  payload: WritePayload<T>,
  meta: EventMeta,
  context: Ctx,
) => WritePayload<T> | void | Promise<WritePayload<T> | void>

/** before* 的 handler：自動 return（不回傳沿用原 payload）
 *
 * payload 形狀同 WritePayload（關聯收 FK 或巢狀 partial、日期 string），非展開後的 read row\
 * ── filter 在 PayloadService 收巢狀成 FK 之前觸發，拿到的是 createOne/updateOne 原始輸入
 */
export type FilterHandler<T, S extends SchemaShape = RegisteredSchema> = PayloadHandler<T, FilterContext<S>>

/** delete 無 row payload，故第一參數改給正規化後的 keys */
export type DeleteHandler<S extends SchemaShape = RegisteredSchema> = (keys: string[], meta: EventMeta, context: FilterContext<S>) => void | Promise<void>

export type ActionHandler<T = Record<string, unknown>> = (meta: ActionMeta<T>, context: EventContext) => void | Promise<void>

/** middleware 包裝的 next：同一組 middleware 供 before* 與 after* 共用，故 ctx 不能假設有 `database`（after* 沒有） */
export type MiddlewareHandler<T> = PayloadHandler<T, EventContext>

/** middleware 陣列依書寫順序執行：index 0 最外層、最先跑 */
export type FilterMiddleware = <T>(next: MiddlewareHandler<T>) => MiddlewareHandler<T>

type GateBrand = Record<typeof import('./middleware.js').GATE, true>

/** 授權型 middleware 的標記，after* / action 的簽章據此擋下 */
export type GateMiddleware = FilterMiddleware & GateBrand

/** 把 gate 映成說明字串，錯誤訊息即指出該改掛哪裡\
 *  after* 觸發時 mutation 已 commit，gate 丟的 ForbiddenError 攔不下任何東西、只會被記進 logger
 */
type NoGate<M extends readonly unknown[]> = {
  [I in keyof M]: M[I] extends GateBrand
    ? '授權 gate 只能掛 before* / filter：after* 時 mutation 已 commit，throw 擋不下任何東西'
    : M[I];
}

export type PermissionCheck = (args: {
  payload: Record<string, unknown>;
  meta: EventMeta;
  accountability: Accountability | null;
}) => boolean | Promise<boolean>

/** app/routes/middlewares 系列拿的 Express app 是唯一能在 router 掛載前插 middleware 的把手\
 *  cli 系列的 commander program 無對應 @types 故留 unknown，使用端自行 cast
 */
export interface InitMetaMap {
  'app.before': { app: Application };
  'app.after': { app: Application };
  'routes.before': { app: Application };
  'routes.after': { app: Application };
  'routes.custom.before': { app: Application };
  'routes.custom.after': { app: Application };
  'middlewares.before': { app: Application };
  'middlewares.after': { app: Application };
  'cli.before': { program: unknown };
  'cli.after': { program: unknown };
}

export type InitEvent = keyof InitMetaMap

/** 同 express PathParams，不直接 import（它在 express-serve-static-core、匯出位置脆弱） */
type RoutePath = string | RegExp | Array<string | RegExp>

/** routes.before 時點 authenticate 已跑、accountability 必有（內層 user 仍可 null） */
type AuthedRequest = Request & { accountability: Accountability }
/** routes.after 的 error handler 可能接到 authenticate 本身的失敗、那時從沒設過 → optional */
type MaybeAuthedRequest = Request & { accountability?: Accountability | null }

type RouteGuard = (req: AuthedRequest, res: Response, next: NextFunction) => void | Promise<void>
type RouteErrorHandler = (err: unknown, req: MaybeAuthedRequest, res: Response, next: NextFunction) => void | Promise<void>

export interface HookTools<S extends SchemaShape> extends DataAccess<S> {
  // before* 多一條「只給 middleware、省略 handler」多載：純 gate（throw 擋下、否則 payload 原樣放行）
  // after* 不提供 —— 寫入後的 handler 即本體，middleware-only 無語意
  beforeCreate: (<C extends Collection<S>>(collection: C, handler: FilterHandler<CollectionItem<S, C>, S>) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[]) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: FilterHandler<CollectionItem<S, C>, S>) => void);
  beforeUpdate: (<C extends Collection<S>>(collection: C, handler: FilterHandler<CollectionItem<S, C>, S>) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[]) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: FilterHandler<CollectionItem<S, C>, S>) => void);
  beforeDelete: (<C extends Collection<S>>(collection: C, handler: DeleteHandler<S>) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[]) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: DeleteHandler<S>) => void);

  afterCreate: (<C extends Collection<S>>(collection: C, handler: ActionHandler<CollectionItem<S, C>>) => void) & (<C extends Collection<S>, const M extends readonly FilterMiddleware[]>(collection: C, middleware: M & NoGate<M>, handler: ActionHandler<CollectionItem<S, C>>) => void);
  afterUpdate: (<C extends Collection<S>>(collection: C, handler: ActionHandler<CollectionItem<S, C>>) => void) & (<C extends Collection<S>, const M extends readonly FilterMiddleware[]>(collection: C, middleware: M & NoGate<M>, handler: ActionHandler<CollectionItem<S, C>>) => void);
  afterDelete: (<C extends Collection<S>>(collection: C, handler: ActionHandler<CollectionItem<S, C>>) => void) & (<C extends Collection<S>, const M extends readonly FilterMiddleware[]>(collection: C, middleware: M & NoGate<M>, handler: ActionHandler<CollectionItem<S, C>>) => void);

  /** before / after 未覆蓋的事件（items.read、auth.*、request.*、server.*…）保留全名 */
  filter: ((event: string, handler: (payload: unknown, meta: EventMeta, ctx: FilterContext<S>) => unknown) => void) & ((event: string, middleware: FilterMiddleware[]) => void) & ((event: string, middleware: FilterMiddleware[], handler: (payload: unknown, meta: EventMeta, ctx: FilterContext<S>) => unknown) => void);
  action: ((event: string, handler: ActionHandler) => void) & (<const M extends readonly FilterMiddleware[]>(event: string, middleware: M & NoGate<M>, handler: ActionHandler) => void);

  schedule: (cron: string, handler: () => void | Promise<void>) => void;
  init: <E extends InitEvent>(event: E, handler: (meta: InitMetaMap[E]) => void) => void;

  // 包成專用簽章才能把 handler 型別釘死（req/res/next 不再吃 app.use 多載的浮動推斷）
  // 其餘 init 時點走 init 逃生口
  /** 省略 path → app 全域，給 path → 只攔該前綴（如 '/files'，須對齊 Directus 核心路由） */
  beforeRoutes: ((handler: RouteGuard) => void) & ((path: RoutePath, handler: RouteGuard) => void);
  /** 上游 next(err) 時觸發，省略 path → app 全域，給 path → 只接該前綴的錯誤\
   *  404 fallback（一般 3 參數 terminal）罕用、不在此暴露，需要時走 init('routes.after')
   */
  afterRoutes: ((handler: RouteErrorHandler) => void) & ((path: RoutePath, handler: RouteErrorHandler) => void);
  embed: (position: 'head' | 'body', code: string | (() => string)) => void;
  logger: Logger;
}
