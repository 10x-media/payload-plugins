import type { Params, SanitizedConfig } from 'payload'
import { formatAdminURL } from 'payload/shared'

/** The admin path the reader asked for, with the filters they had, ready to come back to. */
const returnPath = (config: SanitizedConfig, params?: Params, searchParams?: Params): string => {
	const segments = Array.isArray(params?.segments) ? params.segments : []
	const path = formatAdminURL({
		adminRoute: config.routes.admin,
		path: segments.length > 0 ? `/${segments.join('/')}` : null,
	})

	const query = new URLSearchParams()
	for (const [key, value] of Object.entries(searchParams ?? {})) {
		// An inherited `redirect` would nest one round trip inside another.
		if (key === 'redirect' || value === undefined) continue
		for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry)
	}

	const queryString = query.toString()
	return queryString ? `${path}?${queryString}` : path
}

/**
 * Where to send a reader the view will not render for. Custom admin views bypass the root
 * router's auth redirect, so the view enforces this itself.
 *
 * Two destinations, as in Payload: nobody signed in goes to the login route, somebody
 * signed in without permission goes to the unauthorized route. Sending the latter back to
 * a form they already passed would loop.
 *
 * The filters live in the URL, so the query string travels along and the reader lands on
 * the same list rather than an unfiltered one.
 */
export const authRedirectUrl = ({
	config,
	params,
	searchParams,
	user,
}: {
	config: SanitizedConfig
	params?: Params
	searchParams?: Params
	user: unknown
}): string => {
	const target = formatAdminURL({
		adminRoute: config.routes.admin,
		path: user ? config.admin.routes.unauthorized : config.admin.routes.login,
	})
	const returnTo = returnPath(config, params, searchParams)

	// Empty when the view sits at the admin root, where there is nothing to come back to.
	return returnTo ? `${target}?redirect=${encodeURIComponent(returnTo)}` : target
}
