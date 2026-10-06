import type { Params, SanitizedConfig } from 'payload'
import { formatAdminURL } from 'payload/shared'

/** The admin path the reader asked for, with the state they had, ready to come back to. */
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
 * Where to send a reader who is not signed in. Custom admin views bypass the root router's
 * auth redirect, so the view enforces this itself. The view's whole state lives in the query
 * string, so it travels along and the reader lands back on the same dashboard.
 */
export const loginRedirectUrl = ({
	config,
	params,
	searchParams,
}: {
	config: SanitizedConfig
	params?: Params
	searchParams?: Params
}): string => {
	const target = formatAdminURL({
		adminRoute: config.routes.admin,
		path: config.admin.routes.login,
	})
	return `${target}?redirect=${encodeURIComponent(returnPath(config, params, searchParams))}`
}
