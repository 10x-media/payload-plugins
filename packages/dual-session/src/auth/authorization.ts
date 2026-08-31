import type { CollectionSlug, Payload } from 'payload'

/** The `Authorization` prefixes `extractJWT` recognises, keyed by its `jwtOrder` entries. */
const SCHEMES: Partial<Record<string, string>> = {
	Bearer: 'Bearer ',
	JWT: 'JWT ',
}

/**
 * The token an `Authorization` header carries, if Payload would read it ahead of a cookie.
 *
 * Mirrors `extractJWT` minus its cookie method: for an isolated collection the shared
 * `${cookiePrefix}-token` is never a valid source, so consulting core's extraction whole
 * would answer with another session's token. Schemes listed after `cookie` in `jwtOrder`
 * do not outrank it and are ignored.
 */
export const extractAuthorizationToken = ({
	headers,
	payload,
}: {
	headers: Headers
	payload: Payload
}): string | undefined => {
	const header = headers.get('Authorization')

	if (!header) {
		return undefined
	}

	for (const method of payload.config.auth.jwtOrder) {
		if (method === 'cookie') {
			return undefined
		}

		const prefix = SCHEMES[method]

		if (prefix && header.startsWith(prefix)) {
			return header.slice(prefix.length)
		}
	}

	return undefined
}

/**
 * True when `Authorization` carries credentials Payload would honour ahead of a cookie.
 *
 * Two unrelated credentials share that header. An **API key** (`<slug> API-Key <key>`) is
 * matched by its own strategy, which sits directly behind a collection's declared ones and
 * owes nothing to `jwtOrder`. A **JWT** is read by `extractJWT`, where `jwtOrder` ranks the
 * `JWT` and `Bearer` schemes against the cookie and defaults to putting them first.
 *
 * The isolated strategy runs ahead of both, so without this check moving a collection onto
 * its own cookie would quietly invert that precedence: a request holding both an isolated
 * cookie and an `Authorization` header would resolve to the cookie's user where core
 * resolves to the header's.
 */
export const hasPrecedingAuthorization = ({
	headers,
	payload,
	slug,
}: {
	headers: Headers
	payload: Payload
	slug: CollectionSlug
}): boolean => {
	const header = headers.get('Authorization')

	if (!header) {
		return false
	}

	if (payload.collections[slug]?.config.auth.useAPIKey && header.startsWith(`${slug} API-Key `)) {
		return true
	}

	return extractAuthorizationToken({ headers, payload }) !== undefined
}
