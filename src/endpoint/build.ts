// 把原生 express Router 包成 route.get/post… + guards + Standard Schema + 回傳語義 wrapper
// guards 依序執行、回傳物件 merge 進 ctx（型別累加）
// handler 回傳值自動序列化
// throw 交 Directus error handler 轉對應 HTTP

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

  // response schema（如有）驗證輸出：不符 = server bug → 500 + log，不外洩細節
  const validateResponse = async (
    schema: RouteOptions<readonly Guard[]>['response'],
    value: unknown,
  ): Promise<unknown> => {
    if (!schema || value === undefined)
      return value
    const result = await runStandard(schema, value)
    if ('issues' in result) {
      logger.error({ issues: result.issues }, 'directus-kit: response validation failed')
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
      const hasOptions = typeof maybeHandler === 'function'
      const options: RouteOptions<readonly Guard[]> = hasOptions
        ? (optionsOrHandler as RouteOptions<readonly Guard[]>)
        : {}
      const handler = (hasOptions ? maybeHandler : (optionsOrHandler as AnyHandler))!

      router[method](path, async (req: Request, res: Response, next: NextFunction) => {
        const accountability = getAccountability(req)
        // route scope：guards 與 handler 都跑在此 scope 下，items({as:'caller'}) 取得本請求身分
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

            // guards 依序 await，回傳物件 merge 進 ctx；throw 即中止並由 catch 轉 HTTP
            for (const guard of options.guards ?? []) {
              const extra = await guard(ctx)
              if (extra)
                Object.assign(ctx, extra)
            }

            const result = await handler(ctx)

            // streaming：handler 自行寫 res，回傳 RAW，wrapper 放手
            if (result === RAW)
              return

            if (isReply(result)) {
              const validated = await validateResponse(options.response, result.body)
              if (validated === undefined)
                res.status(result.status).end()
              else res.status(result.status).json(validated)
              return
            }

            const validated = await validateResponse(options.response, result)
            res.json(validated)
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
