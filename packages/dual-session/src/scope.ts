import type { AuthScope } from './types'

const isWithin = (pathname: string, base: string) =>
	pathname === base || pathname.startsWith(`${base}/`)

/**
 * Decides which session a request may authenticate against.
 *
 * Admin panel pages and their server actions live under `adminRoute`, so those are
 * unambiguous. Payload's REST namespace is shared between the admin panel and the
 * website, so those calls are attributed by `Referer` — same-origin browser fetches
 * carry the full originating path. An unattributed API call falls back to `admin`,
 * which means "no frontend cookie is honoured": the conservative choice, since it can
 * only ever result in an unauthenticated request, never a wrongly authenticated one.
 */
export const resolveAuthScope = ({
	adminRoute = '/admin',
	apiRoute = '/api',
	pathname,
	referer,
}: {
	adminRoute?: string
	apiRoute?: string
	pathname: string
	referer?: null | string
}): AuthScope => {
	if (isWithin(pathname, adminRoute)) {
		return 'admin'
	}

	if (isWithin(pathname, apiRoute)) {
		if (!referer) {
			return 'admin'
		}

		try {
			return isWithin(new URL(referer).pathname, adminRoute) ? 'admin' : 'frontend'
		} catch {
			return 'admin'
		}
	}

	return 'frontend'
}
