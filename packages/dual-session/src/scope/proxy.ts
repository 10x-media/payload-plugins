import { type NextRequest, NextResponse } from 'next/server'
import type { AuthScope } from '../types'
import { AUTH_SCOPE_HEADER, resolveAuthScope } from './resolveAuthScope'

export type AuthScopeProxyOptions = {
	/** Admin panel route prefix. @default '/admin' */
	adminRoute?: string
	/** Payload REST/GraphQL route prefix. @default '/api' */
	apiRoute?: string
	/** Override the default rule entirely. Return `undefined` to fall back to it. */
	resolveScope?: (request: NextRequest) => AuthScope | undefined
	/** Header to write the resolved scope into. @default 'x-payload-auth-scope' */
	scopeHeader?: string
}

/**
 * Next.js proxy (`proxy.ts`, called middleware before Next 16) that stamps every
 * request with its auth scope, so the isolated auth strategies know whether they are
 * allowed to authenticate it.
 *
 * The header is always overwritten, never merged — a client cannot choose its own scope.
 *
 * ```ts
 * // proxy.ts (Next 16) or middleware.ts (Next 15)
 * import { createAuthScopeProxy } from '@10x-media/dual-session/proxy'
 *
 * export default createAuthScopeProxy()
 *
 * export const config = {
 *   matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
 * }
 * ```
 */
export const createAuthScopeProxy =
	(options: AuthScopeProxyOptions = {}) =>
	(request: NextRequest) => {
		const { adminRoute, apiRoute, resolveScope, scopeHeader = AUTH_SCOPE_HEADER } = options

		const scope =
			resolveScope?.(request) ??
			resolveAuthScope({
				adminRoute,
				apiRoute,
				pathname: request.nextUrl.pathname,
				referer: request.headers.get('Referer'),
			})

		const headers = new Headers(request.headers)
		headers.set(scopeHeader, scope)

		return NextResponse.next({ request: { headers } })
	}

export type { AuthScope } from '../types'
export { AUTH_SCOPE_HEADER, resolveAuthScope } from './resolveAuthScope'
