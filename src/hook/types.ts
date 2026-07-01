import type { Accountability, Logger } from '../core/types.js'
import type { CollectionItem, SchemaShape, WritePayload } from '../data-access/typed-items.js'
import type { DataAccess } from '../data-access/types.js'
import type { Application, NextFunction, Request, Response } from 'express'

type Collection<S extends SchemaShape> = keyof S & string

// ============ 事件 meta ============

export interface EventMeta {
  event: string;
  collection: string;
  keys: string[];
}
export interface ActionMeta extends EventMeta {
  payload: Record<string, unknown>;
}
export interface EventContext {
  accountability: Accountability | null;
}

// ============ handler ============

/** before* 的 handler：自動 return（不回傳沿用原 payload）
 *
 * payload 形狀同 WritePayload（關聯收 FK 或巢狀 partial、日期 string），非展開後的 read row
 * ── filter 在 PayloadService 收巢狀成 FK 之前觸發，拿到的是 createOne/updateOne 原始輸入
 */
export type FilterHandler<T> = (
  payload: WritePayload<T>,
  meta: EventMeta,
  context: EventContext,
) => WritePayload<T> | void | Promise<WritePayload<T> | void>

/** beforeDelete 的 handler：第一參數是正規化的 keys（delete 無 row payload） */
export type DeleteHandler = (keys: string[], meta: EventMeta, context: EventContext) => void | Promise<void>

/** after* 的 handler：寫入後副作用，無回傳 */
export type ActionHandler = (meta: ActionMeta, context: EventContext) => void | Promise<void>

// ============ middleware ============

/** filter 中介層：包住 next、回傳新 handler，進 middleware 陣列依書寫順序執行 */
export type FilterMiddleware = <T>(next: FilterHandler<T>) => FilterHandler<T>

export type PermissionCheck = (args: {
  payload: Record<string, unknown>;
  meta: EventMeta;
  accountability: Accountability | null;
}) => boolean | Promise<boolean>

// ============ Hook tools ============

/** 各 init 時點 Directus 注入的 meta：app/routes/middlewares 系列拿 Express app
 *  （唯一能在 router 掛載前插 middleware 的把手），cli 系列拿 commander program
 *  program 無對應 @types 故留 unknown，使用端自行 cast
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

// ============ route middleware mounting ============

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
  // 不與其他多載衝突——第二參數是陣列在 runtime 唯一代表 middleware
  // after* 不提供此形式：寫入後的 handler 即本體，middleware-only 無語意（見 build.ts registerAction）
  beforeCreate: (<C extends Collection<S>>(collection: C, handler: FilterHandler<CollectionItem<S, C>>) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[]) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: FilterHandler<CollectionItem<S, C>>) => void);
  beforeUpdate: (<C extends Collection<S>>(collection: C, handler: FilterHandler<CollectionItem<S, C>>) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[]) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: FilterHandler<CollectionItem<S, C>>) => void);
  beforeDelete: (<C extends Collection<S>>(collection: C, handler: DeleteHandler) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[]) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: DeleteHandler) => void);

  afterCreate: (<C extends Collection<S>>(collection: C, handler: ActionHandler) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: ActionHandler) => void);
  afterUpdate: (<C extends Collection<S>>(collection: C, handler: ActionHandler) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: ActionHandler) => void);
  afterDelete: (<C extends Collection<S>>(collection: C, handler: ActionHandler) => void) & (<C extends Collection<S>>(collection: C, middleware: FilterMiddleware[], handler: ActionHandler) => void);

  // 逃生口的純 middleware 對稱同 before*／after*：
  // filter 屬 before（可 throw 擋下）→ 純 gate 可省略 handler
  // action 屬 after（handler 即本體）→ 不提供 middleware-only
  /** before / after 未覆蓋的事件（items.read、auth.*、request.*、server.*…）保留全名 */
  filter: ((event: string, handler: (payload: unknown, meta: EventMeta, ctx: EventContext) => unknown) => void) & ((event: string, middleware: FilterMiddleware[]) => void) & ((event: string, middleware: FilterMiddleware[], handler: (payload: unknown, meta: EventMeta, ctx: EventContext) => unknown) => void);
  action: ((event: string, handler: ActionHandler) => void) & ((event: string, middleware: FilterMiddleware[], handler: ActionHandler) => void);

  schedule: (cron: string, handler: () => void | Promise<void>) => void;
  init: <E extends InitEvent>(event: E, handler: (meta: InitMetaMap[E]) => void) => void;

  // init('routes.before'/'routes.after', ({app}) => app.use(...)) 的常用包裝
  // handler 型別由此釘死（req/res/next 不再吃 app.use 多載的浮動推斷），其餘 init 時點用 init 逃生口
  /** routes.before：core 路由前掛 guard / 攔截（authenticate 下游、req.accountability 必有）
   *  省略 path → app 全域，給 path → 只攔該前綴（如 '/files'，須對齊 Directus 核心路由）
   */
  beforeRoutes: ((handler: RouteGuard) => void) & ((path: RoutePath, handler: RouteGuard) => void);
  /** routes.after：掛 error handler（上游 next(err) 時觸發）
   *  錯誤可能源於 authenticate 本身 → req.accountability 可能無（optional）
   *  省略 path → app 全域，給 path → 只接該前綴的錯誤
   *  404 fallback（一般 3 參數 terminal）罕用、不在此暴露，需要時走 init('routes.after')
   */
  afterRoutes: ((handler: RouteErrorHandler) => void) & ((path: RoutePath, handler: RouteErrorHandler) => void);
  embed: (position: 'head' | 'body', code: string | (() => string)) => void;
  logger: Logger;
}
