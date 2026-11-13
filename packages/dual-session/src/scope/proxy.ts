import { type NextRequest, NextResponse } from 'next/server'
import type { AuthScope } from '../types'
import { AUTH_SCOPE_HEADER, resolveAuthScope } from './resolveAuthScope'
import { isStaleSharedToken, withoutCookie } from './staleSharedToken'

export type ClearStaleSharedCookieOptions = {
	/**
	 * The collections isolated whole, as listed in the plugin's `collections`. Leave out a
	 * role-split collection (one with an `isolate` predicate): its admins live in the shared
	 * cookie legitimately, and the proxy has no user to ask.
	 */
	collections: readonly string[]
	/** Payload's `cookiePrefix`. @default 'payload' */
	cookiePrefix?: string
	/** The `auth.cookies.domain` the shared cookie was written with, if any. */
	domain?: string
}

export type AuthScopeProxyOptions = {
	/** Admin panel route prefix. @default '/admin' */
	adminRoute?: string
	/** Payload REST/GraphQL route prefix. @default '/api' */
	apiRoute?: string
	/**
	 * Drop a token of an isolated collection from the shared `${cookiePrefix}-token`: it is
	 * removed from the forwarded request and expired in the browser. The plugin already
	 * refuses to authenticate such a token; this stops it lingering.
	 *
	 * The proxy cannot read the Payload config, so the collections are listed here.
	 * @default off
	 */
	clearStaleSharedCookie?: ClearStaleSharedCookieOptions
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
 * The header is replaced on every request, never merged, and is removed when the
 * request cannot be attributed, so the scope a strategy reads is always this proxy's
 * own answer.
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
		const {
			adminRoute,
			apiRoute,
			clearStaleSharedCookie,
			resolveScope,
			scopeHeader = AUTH_SCOPE_HEADER,
		} = options

		const scope =
			resolveScope?.(request) ??
			resolveAuthScope({
				adminRoute,
				apiRoute,
				origin: request.nextUrl.origin,
				pathname: request.nextUrl.pathname,
				referer: request.headers.get('Referer'),
				secFetchSite: request.headers.get('Sec-Fetch-Site'),
			})

		const sharedName = `${clearStaleSharedCookie?.cookiePrefix ?? 'payload'}-token`
		const stale =
			clearStaleSharedCookie !== undefined &&
			isStaleSharedToken(request.cookies.get(sharedName)?.value, clearStaleSharedCookie.collections)

		const headers = stale
			? withoutCookie(request.headers, sharedName)
			: new Headers(request.headers)

		// An unattributable request carries no scope at all. Stamping a guess here would
		// override `adminSessionPriority`, which answers the same question better by
		// looking at whether an admin session actually exists.
		if (scope) {
			headers.set(scopeHeader, scope)
		} else {
			headers.delete(scopeHeader)
		}

		const response = NextResponse.next({ request: { headers } })

		if (stale) {
			response.cookies.set(sharedName, '', {
				domain: clearStaleSharedCookie?.domain,
				expires: new Date(0),
				httpOnly: true,
				path: '/',
			})
		}

		return response
	}

export type { AuthScope } from '../types'
export { AUTH_SCOPE_HEADER, resolveAuthScope } from './resolveAuthScope'
export { isStaleSharedToken, withoutCookie } from './staleSharedToken'
