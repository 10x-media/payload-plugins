import type { Payload } from 'payload'

/**
 * Port of the CSRF gate Payload applies to its own cookie token extraction
 * (`extractJWT`'s `cookie` method). Isolated cookies must be held to the same
 * standard, otherwise moving a collection off the shared cookie would quietly
 * weaken its CSRF protection.
 */
export const isCookieAuthAllowed = ({
	headers,
	payload,
}: {
	headers: Headers
	payload: Payload
}): boolean => {
	const origin = headers.get('Origin')

	// Origin present, validate against the csrf allowlist
	if (origin) {
		return payload.config.csrf.length === 0 || payload.config.csrf.includes(origin)
	}

	// No Origin and no csrf configured, so there is no allowlist to enforce
	if (payload.config.csrf.length === 0) {
		return true
	}

	// No Origin with csrf configured, fall back to Sec-Fetch-Site
	const secFetchSite = headers.get('Sec-Fetch-Site')

	// Allow same-origin, same-site, and direct navigations (none)
	return secFetchSite === 'same-origin' || secFetchSite === 'same-site' || secFetchSite === 'none'
}
