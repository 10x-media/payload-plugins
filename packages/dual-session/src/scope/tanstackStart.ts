import { createMiddleware } from '@tanstack/react-start'
import { findStaleSharedCookie, withoutCookie } from './staleSharedToken'
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
	createMiddleware().server(async ({ handlerType, next, request }) => {
		const url = new URL(request.url)
		const stale = findStaleSharedCookie(request.headers, options.clearStaleSharedCookie)

		if (stale) {
			const cookie = withoutCookie(request.headers, stale).get('Cookie')

			if (cookie) {
				request.headers.set('Cookie', cookie)
			} else {
				request.headers.delete('Cookie')
			}
		}

		stampAuthScope({
			headers: request.headers,
			isServerFunction: handlerType === 'serverFn',
			options,
			origin: url.origin,
			pathname: url.pathname,
			request,
		})

		const result = await next()

		if (!stale) {
			return result
		}

		// A handler may return a response whose headers are immutable (a `Response.redirect`, a
		// proxied `fetch`), so the cookie is expired on a copy.
		const response = new Response(result.response.body, result.response)
		response.headers.append(
			'Set-Cookie',
			expireCookie(stale, options.clearStaleSharedCookie?.domain)
		)

		return { ...result, response }
	})

/** A `Set-Cookie` value that expires `name` in the browser, matching how Payload wrote it. */
const expireCookie = (name: string, domain: string | undefined): string =>
	[
		`${name}=`,
		...(domain ? [`Domain=${domain}`] : []),
		'Path=/',
		'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
		'HttpOnly',
	].join('; ')
