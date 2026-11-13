import type { AuthScope } from '../types'
import { AUTH_SCOPE_HEADER, resolveAuthScope } from './resolveAuthScope'
import type { ClearStaleSharedCookieOptions } from './staleSharedToken'

/** Options shared by the framework adapters that stamp a request with its scope. */
export type AuthScopeRequestOptions<TRequest extends Request = Request> = {
	/** Admin panel route prefix. @default '/admin' */
	adminRoute?: string
	/** Payload REST/GraphQL route prefix. @default '/api' */
	apiRoute?: string
	/**
	 * Drop a token of an isolated collection from the shared `${cookiePrefix}-token`: it is
	 * removed from the forwarded request and expired in the browser. The plugin already
	 * refuses to authenticate such a token; this stops it lingering.
	 *
	 * The adapter cannot read the Payload config, so the collections are listed here.
	 * @default off
	 */
	clearStaleSharedCookie?: ClearStaleSharedCookieOptions
	/** Override the default rule entirely. Return `undefined` to fall back to it. */
	resolveScope?: (request: TRequest) => AuthScope | undefined
	/** Header to write the resolved scope into. @default 'x-payload-auth-scope' */
	scopeHeader?: string
}

/**
 * Resolves a request's scope and writes it into `headers`: the part every framework adapter
 * shares. The header is replaced, never merged, and is removed when the request cannot be
 * attributed, so the scope a strategy reads is always this function's own answer and never
 * one the client sent.
 */
export const stampAuthScope = <TRequest extends Request>({
	headers,
	isServerFunction,
	options,
	origin,
	pathname,
	request,
}: {
	/** Where the scope is written: the request's own headers, or the copy handed downstream. */
	headers: Headers
	isServerFunction?: boolean
	options: AuthScopeRequestOptions<TRequest>
	origin: string
	pathname: string
	request: TRequest
}): AuthScope | undefined => {
	const { adminRoute, apiRoute, resolveScope, scopeHeader = AUTH_SCOPE_HEADER } = options

	const scope =
		resolveScope?.(request) ??
		resolveAuthScope({
			adminRoute,
			apiRoute,
			isServerFunction,
			origin,
			pathname,
			referer: request.headers.get('Referer'),
			secFetchSite: request.headers.get('Sec-Fetch-Site'),
		})

	// An unattributable request carries no scope at all. Stamping a guess here would
	// override `adminSessionPriority`, which answers the same question better by
	// looking at whether an admin session actually exists.
	if (scope) {
		headers.set(scopeHeader, scope)
	} else {
		headers.delete(scopeHeader)
	}

	return scope
}
