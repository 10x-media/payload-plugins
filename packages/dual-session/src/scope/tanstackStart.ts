import { createMiddleware } from '@tanstack/react-start'
import { type AuthScopeRequestOptions, stampAuthScope } from './stampAuthScope'

export type AuthScopeMiddlewareOptions = AuthScopeRequestOptions

/**
 * TanStack Start request middleware that stamps every request with its auth scope, so the
 * isolated auth strategies know whether they are allowed to authenticate it. The TanStack
 * Start counterpart of `createAuthScopeProxy` from `@10x-media/dual-session/next`.
 *
 * Payload's TanStack Start adapter reads headers from the request itself, not from anything
 * a middleware passes on, so the scope is written into the request's own headers. Server
 * function calls (`handlerType: 'serverFn'`) share one endpoint between the admin panel and
 * the website, so they are attributed by `Referer` like REST calls.
 *
 * A global `requestMiddleware` list replaces TanStack Start's default CSRF middleware, so list
 * it again with its default filter (server functions only; unfiltered it also refuses REST
 * calls and page loads that carry no origin headers):
 *
 * ```ts
 * // src/start.ts
 * import { createAuthScopeMiddleware } from '@10x-media/dual-session/tanstack-start'
 * import { createCsrfMiddleware, createStart } from '@tanstack/react-start'
 *
 * export const startInstance = createStart(() => ({
 *   requestMiddleware: [
 *     createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === 'serverFn' }),
 *     createAuthScopeMiddleware(),
 *   ],
 * }))
 * ```
 */
export const createAuthScopeMiddleware = (options: AuthScopeMiddlewareOptions = {}) =>
	createMiddleware().server(({ handlerType, next, request }) => {
		const url = new URL(request.url)

		stampAuthScope({
			headers: request.headers,
			isServerFunction: handlerType === 'serverFn',
			options,
			origin: url.origin,
			pathname: url.pathname,
			request,
		})

		return next()
	})
