import type { AuthScope } from '../types'

/** Request header carrying the resolved {@link AuthScope} for a request. */
export const AUTH_SCOPE_HEADER = 'x-payload-auth-scope'

const isWithin = (pathname: string, base: string) =>
	pathname === base || pathname.startsWith(`${base}/`)

/**
 * Decides which session a request may authenticate against, or `undefined` when the
 * request carries no signal to decide by.
 *
 * Admin panel pages and their server actions live under `adminRoute`, so those are
 * unambiguous. Payload's REST namespace is shared between the admin panel and the
 * website, so those calls are attributed by `Referer` — same-origin browser fetches
 * carry the full originating path.
 *
 * A `Referer` only says something about the admin panel when it belongs to the same
 * origin the API is served from: a frontend on another origin may well have an
 * `/admin` route of its own. `Sec-Fetch-Site` is what distinguishes the two, and a
 * page cannot forge it.
 *
 * `undefined` means "no attribution", not "admin": callers should leave the scope
 * header unset so the strategies fall back to `adminSessionPriority`.
 */
export const resolveAuthScope = ({
	adminRoute = '/admin',
	apiRoute = '/api',
	pathname,
	referer,
	secFetchSite,
}: {
	adminRoute?: string
	apiRoute?: string
	pathname: string
	referer?: null | string
	/** The request's `Sec-Fetch-Site` header, when it has one. */
	secFetchSite?: null | string
}): AuthScope | undefined => {
	if (isWithin(pathname, adminRoute)) {
		return 'admin'
	}

	if (isWithin(pathname, apiRoute)) {
		if (!referer) {
			return undefined
		}

		if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
			return 'frontend'
		}

		try {
			return isWithin(new URL(referer).pathname, adminRoute) ? 'admin' : 'frontend'
		} catch {
			return undefined
		}
	}

	return 'frontend'
}
