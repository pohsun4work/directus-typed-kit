// 把原生 express Router 包成 route.get/post… + guards + Standard Schema + 回傳語義 wrapper

import { contextStore } from '../core/context.js'
import { ResponseValidationError } from '../core/errors.js'
import { createDataAccess } from '../data-access/access.js'
import { runStandard } from '../schema/standard-schema.js'
import { isReply, RAW } from './schema-guards.js'

import type { Accountability, Logger, SchemaOverview } from '../core/types.js'
import type { SchemaShape } from '../data-access/typed-items.js'
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
  getSchema: () => Promise<SchemaOverview>;
  logger: Logger;
}

type AnyHandler = (ctx: RouteContext) => unknown | Promise<unknown>

function getAccountability(req: Request): Accountability | null {
  return (req as Request & { accountability?: Accountability }).accountability ?? null
}

export function buildEndpointTools<S extends SchemaShape>(
  router: Router,
  context: NativeEndpointContext,
): EndpointTools<S> {
  const access = createDataAccess<S>({
    knex: context.database as never,
    services: context.services,
    getSchema: context.getSchema,
  })
  const logger = context.logger

  /** response schema 驗證輸出：不符 = server bug → 500 + log，不外洩細節 */
  const validateResponse = async (
    schema: RouteOptions<readonly Guard[]>['response'],
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

  const makeRoute = (method: 'get' | 'post' | 'put' | 'patch' | 'delete'): Route => {
    const verb = ((
      path: string,
      optionsOrHandler: RouteOptions<readonly Guard[]> | AnyHandler,
      maybeHandler?: AnyHandler,
    ) => {
      // 有第三參數才代表第二參數是 options，否則第二參數即 handler
      const hasSeparateHandler = typeof maybeHandler === 'function'
      const options: RouteOptions<readonly Guard[]> = hasSeparateHandler
        ? (optionsOrHandler as RouteOptions<readonly Guard[]>)
        : {}
      const handler = (hasSeparateHandler ? maybeHandler : (optionsOrHandler as AnyHandler))!

      router[method](path, async (req: Request, res: Response, next: NextFunction) => {
        const accountability = getAccountability(req)
        // guards 與 handler 都跑在此 scope 下，items({as:'caller'}) 才取得本請求身分
        await contextStore.run({ accountability }, async () => {
          try {
            const ctx: RouteContext = {
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
              if (extra)
                Object.assign(ctx, extra)
            }

            const result = await handler(ctx)

            // streaming：handler 自行寫 res，回傳 RAW，wrapper 放手
            if (result === RAW)
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
    }) as Route
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
