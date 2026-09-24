import type { Payload } from 'payload'

import type { ResolvedOptions } from '../types'

/**
 * Cookie POSTs that start, exit, or end a session must be same-origin. This is
 * deliberately stricter than Payload's `extractJWT` cookie CSRF gate and than
 * dual-session's `isCookieAuthAllowed`: `same-site` is denied so a subdomain XSS
 * cannot start an impersonation. JWT/Bearer skip this gate only when that
 * scheme ranks before `cookie` and the header carries a non-empty token. An
 * empty `JWT ` / `Bearer ` prefix must not skip: Payload then authenticates
 * the cookie.
 *
 * Never reads `X-Forwarded-Host` or `X-Forwarded-Proto`.
 */
export const verifyMutationOrigin = ({
	headers,
	options,
	payload,
}: {
	headers: Headers
	options: Pick<ResolvedOptions, 'security'>
	payload: Payload
}): boolean => {
	const authorization = headers.get('Authorization') ?? ''
	const jwtOrder = payload.config.auth?.jwtOrder ?? ['JWT', 'Bearer', 'cookie']
	const cookieRank = jwtOrder.indexOf('cookie')
	const ranksBeforeCookie = (scheme: 'Bearer' | 'JWT') => {
		const rank = jwtOrder.indexOf(scheme)
		return rank !== -1 && (cookieRank === -1 || rank < cookieRank)
	}
	const headerToken = (scheme: 'Bearer' | 'JWT') => {
		const prefix = `${scheme} `
		if (!authorization.startsWith(prefix)) {
			return ''
		}
		return authorization.slice(prefix.length).trim()
	}

	if (headerToken('JWT') && ranksBeforeCookie('JWT')) {
		return true
	}
	if (headerToken('Bearer') && ranksBeforeCookie('Bearer')) {
		return true
	}

	const secFetchSite = headers.get('Sec-Fetch-Site')
	if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
		return false
	}
	if (secFetchSite === 'same-origin') {
		return true
	}

	const origin = headers.get('Origin')
	if (!origin) {
		return false
	}

	const allowlist = [
		...new Set(
			[
				payload.config.serverURL,
				...(payload.config.csrf ?? []),
				...options.security.trustedOrigins,
			].filter((value): value is string => Boolean(value))
		),
	]

	if (allowlist.length > 0) {
		return allowlist.includes(origin)
	}

	try {
		return new URL(origin).host === (headers.get('host') ?? '')
	} catch {
		return false
	}
}

export const isJsonContentType = (headers: Headers): boolean => {
	const value = headers.get('content-type') ?? ''
	return value.toLowerCase().includes('application/json')
}
