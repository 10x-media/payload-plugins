import { type NextRequest, NextResponse } from 'next/server'
import { type AuthScopeRequestOptions, stampAuthScope } from './stampAuthScope'

export type AuthScopeProxyOptions = AuthScopeRequestOptions<NextRequest>

/**
 * Next.js proxy (`proxy.ts`) that stamps every request with its auth scope, so the
 * isolated auth strategies know whether they are allowed to authenticate it.
 *
 * The header is replaced on every request, never merged, and is removed when the
 * request cannot be attributed, so the scope a strategy reads is always this proxy's
 * own answer.
 *
 * ```ts
 * // proxy.ts
 * import { createAuthScopeProxy } from '@10x-media/dual-session/next'
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
		const headers = new Headers(request.headers)

		stampAuthScope({
			headers,
			options,
			origin: request.nextUrl.origin,
			pathname: request.nextUrl.pathname,
			request,
		})

		return NextResponse.next({ request: { headers } })
	}
