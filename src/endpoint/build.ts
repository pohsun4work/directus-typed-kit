// 把原生 express Router 包成 route.get/post… + guards + Standard Schema + 回傳語義 wrapper

import { contextStore } from '../core/context.js'
import { ResponseValidationError } from '../core/errors.js'
import { createDataAccess } from '../data-access/access.js'
import { runStandard } from '../schema/standard-schema.js'
import { isReply, RAW } from './schema-guards.js'

import type { Accountability, Logger, SchemaOverview } from '../core/types.js'
import type { SchemaShape } from '../data-access/typed-items.js'
import type { GetSchemaOptions } from '../data-access/types.js'
import type {
  EndpointTools,
  Guard,
  Route,
  RouteContext,
  RouteOptions,
} from './types.js'
import type { NextFunction, Request, Response, Router } from 'express'

interface NativeEndpointContext {
  database: unknown;
  services: Record<string, unknown>;
  getSchema: (options?: GetSchemaOptions) => Promise<SchemaOverview>;
  logger: Logger;
}

function getAccountability(req: Request): Accountability | null {
  return (req as Request & { accountability?: Accountability }).accountability ?? null
}

// guard 只能往 ctx 加欄位，換掉這些會出事：accountability 覆寫後 ctx 與 contextStore 分岔
// （items({as:'caller'}) 仍用舊身分），存取器被換掉則整條資料路徑失守
// body / query / params 不在此列 —— 那正是內建 guard 收斂型別的產出
const GUARD_RESERVED: ReadonlySet<string> = new Set([
  'req',
  'res',
  'accountability',
  'items',
  'services',
  'service',
  'knex',
  'transaction',
  'getSchema',
])

export function buildEndpointTools<S extends SchemaShape>(
  router: Router,
  context: NativeEndpointContext,
): EndpointTools<S> {
  const logger = context.logger
  const access = createDataAccess<S>({
    knex: context.database as never,
    services: context.services,
    getSchema: context.getSchema,
    logger,
  })

  // 實作層與公開簽章共用同一個 S，handler ctx 不含 guard extras（傳入時多帶欄位不影響 assignable）
  type Handler = (ctx: RouteContext<S>) => unknown
  type Options = RouteOptions<readonly Guard<object, S>[]>

  /** response schema 驗證輸出：不符 = server bug → 500 + log，不外洩細節 */
  const validateResponse = async (
    schema: Options['response'],
    value: unknown,
  ): Promise<unknown> => {
    // 有 schema 就連 undefined 也驗：handler 漏 return 或 reply 無 body 屬破約，須浮現而非靜默放行
    if (!schema)
      return value
    const result = await runStandard(schema, value)
    if ('issues' in result) {
      logger.error({ issues: result.issues }, 'directus-typed-kit: response validation failed')
      throw new ResponseValidationError()
    }
    return result.value
  }

  const makeRoute = (method: 'get' | 'post' | 'put' | 'patch' | 'delete'): Route<S> => {
    const verb = ((
      path: string,
      optionsOrHandler: Options | Handler,
      maybeHandler?: Handler,
    ) => {
      // 有第三參數才代表第二參數是 options，否則第二參數即 handler
      const hasSeparateHandler = typeof maybeHandler === 'function'
      const options: Options = hasSeparateHandler
        ? (optionsOrHandler as Options)
        : {}
      const handler = (hasSeparateHandler ? maybeHandler : (optionsOrHandler as Handler))!

      // 漏傳 handler 不擋的話：註冊照樣成功、guards 從頭到尾沒掛上，第一個請求進來才炸
      if (typeof handler !== 'function')
        throw new TypeError(`directus-typed-kit: route.${method}('${path}') 缺少 handler`)

      router[method](path, async (req: Request, res: Response, next: NextFunction) => {
        const accountability = getAccountability(req)
        // guards 與 handler 都跑在此 scope 下，items({as:'caller'}) 才取得本請求身分
        await contextStore.run({ accountability }, async () => {
          try {
            const ctx: RouteContext<S> = {
              ...access,
              req,
              res,
              params: req.params,
              query: req.query as Record<string, unknown>,
              body: req.body,
              accountability,
            }

            // guards 依序 await，回傳物件 merge 進 ctx，throw 即中止並由 catch 轉 HTTP
            for (const guard of options.guards ?? []) {
              const extra = await guard(ctx)
              if (extra) {
                for (const key of Object.keys(extra)) {
                  if (GUARD_RESERVED.has(key))
                    throw new TypeError(`directus-typed-kit: guard 不可覆寫 ctx 的 "${key}"`)
                }
                Object.assign(ctx, extra)
              }
              // guard 自行寫了 res（redirect / 直接回應）即短路，後續 guard 與 handler 都不該再跑
              if (res.headersSent)
                return
            }

            const result = await handler(ctx)

            // streaming：handler 自行寫 res，回傳 RAW，wrapper 放手
            // 已寫出 res 卻忘了回 RAW 時同樣放手，否則重複寫 header 會把連線打斷成 ECONNRESET
            if (result === RAW || res.headersSent)
              return

            // reply 帶狀態碼與 body，否則整個回傳值即 body、狀態預設 200
            const replying = isReply(result)
            const status = replying ? result.status : 200
            const validated = await validateResponse(options.response, replying ? result.body : result)
            // body 為 undefined 即 end()：不論狀態碼皆不掛 application/json、不寫空 body
            if (validated === undefined)
              res.status(status).end()
            else res.status(status).json(validated)
          }
          catch (err) {
            next(err)
          }
        })
      })
    }) as Route<S>
    return verb
  }

  return {
    ...access,
    router,
    logger,
    accountability: getAccountability,
    route: {
      get: makeRoute('get'),
      post: makeRoute('post'),
      put: makeRoute('put'),
      patch: makeRoute('patch'),
      delete: makeRoute('delete'),
    },
  }
}
