/**
 * Helpers for a token of an isolated collection left behind in the shared
 * `${cookiePrefix}-token`. They have no `next/server` or `payload` import, so the edge
 * proxy and the server strategy share them.
 */

/**
 * The `collection` claim of a JWT, read without verifying its signature, or `undefined`
 * when the value is not a readable JWT.
 *
 * Unverified on purpose: the edge has no secret, and every caller only ever uses the
 * answer to *drop* a credential, which a forged claim cannot turn into access.
 */
export const readCollectionClaim = (token: string): string | undefined => {
	const [, body] = token.split('.')

	if (!body) {
		return undefined
	}

	try {
		const base64 = body.replace(/-/g, '+').replace(/_/g, '/')
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
		const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
		const claims: unknown = JSON.parse(new TextDecoder().decode(bytes))

		if (claims && typeof claims === 'object' && 'collection' in claims) {
			const { collection } = claims as { collection: unknown }
			return typeof collection === 'string' ? collection : undefined
		}
	} catch {
		return undefined
	}

	return undefined
}

/**
 * True when `token`, found in the shared cookie, was minted for one of `collections`:
 * collections whose every session belongs in a cookie of its own, so the shared cookie can
 * only hold one of their tokens by accident (a session from before the plugin was deployed,
 * a GraphQL `login`, a third-party `generatePayloadCookie`).
 *
 * Do not pass a role-split collection (one with an `isolate` predicate). Its admins
 * legitimately live in the shared cookie, and telling them apart needs the user.
 */
export const isStaleSharedToken = (
	token: null | string | undefined,
	collections: readonly string[]
): boolean => {
	if (!token) {
		return false
	}

	const collection = readCollectionClaim(token)
	return collection !== undefined && collections.includes(collection)
}

/**
 * A copy of `headers` whose `Cookie` header no longer carries `name`. The header is removed
 * outright when nothing else is left in it.
 */
export const withoutCookie = (headers: Headers, name: string): Headers => {
	const next = new Headers(headers)
	const cookie = headers.get('Cookie')

	if (!cookie) {
		return next
	}

	const kept = cookie
		.split(';')
		.map((pair) => pair.trim())
		.filter((pair) => pair !== '' && pair.split('=', 1)[0]?.trim() !== name)

	if (kept.length > 0) {
		next.set('Cookie', kept.join('; '))
	} else {
		next.delete('Cookie')
	}

	return next
}

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

/**
 * The name of the shared cookie when `headers` carries a stale token in it (see
 * `isStaleSharedToken`), otherwise `undefined`. The framework adapters use it to drop the
 * cookie from the forwarded request and expire it in the browser.
 */
export const findStaleSharedCookie = (
	headers: Headers,
	options: ClearStaleSharedCookieOptions | undefined
): string | undefined => {
	if (!options) {
		return undefined
	}

	const name = `${options.cookiePrefix ?? 'payload'}-token`
	const token = headers
		.get('Cookie')
		?.split(';')
		.map((pair) => pair.trim())
		.find((pair) => pair.split('=', 1)[0]?.trim() === name)
		?.slice(name.length + 1)

	return isStaleSharedToken(token, options.collections) ? name : undefined
}
