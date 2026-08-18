import type { CollectionSlug, Payload } from 'payload'

import { PLUGIN_SLUG } from './constants'
import { generateIsolatedCookie } from './cookies'
import { resolveCollections } from './plugin/resolveCollections'
import type { DualSessionPluginOptions, ResolvedIsolatedCollection } from './types'

const findOptions = (payload: Payload): DualSessionPluginOptions | undefined =>
	payload.config.plugins?.find((plugin) => plugin.slug === PLUGIN_SLUG)?.options as
		| DualSessionPluginOptions
		| undefined

const findEntry = (
	payload: Payload,
	collection: CollectionSlug
): ResolvedIsolatedCollection | undefined => {
	const options = findOptions(payload)
	if (!options || options.disabled === true) {
		return undefined
	}

	return resolveCollections({
		collections: options.collections,
		cookiePrefix: payload.config.cookiePrefix,
	}).find((entry) => entry.slug === collection)
}

/**
 * The cookie name this collection's sessions live in, or `undefined` when the collection
 * is not isolated (and therefore still uses the shared `${cookiePrefix}-token`).
 *
 * Resolved from the plugin's registered options rather than recomputed, so a `cookieName`
 * override is honoured and callers never hardcode the name.
 */
export const resolveIsolatedCookieName = ({
	collection,
	payload,
}: {
	collection: CollectionSlug
	payload: Payload
}): string | undefined => findEntry(payload, collection)?.cookieName

/**
 * Builds the `Set-Cookie` header value that logs a user into an isolated collection.
 *
 * This is the replacement for Payload's `generatePayloadCookie` in code that mints its own
 * token — an OAuth callback, a server action, a custom login route. Those write the shared
 * `${cookiePrefix}-token` directly, which both bypasses the isolation and overwrites
 * whatever admin session the visitor is holding.
 *
 * ```ts
 * const { token } = await jwtSign({ fieldsToSign, secret, tokenExpiration })
 *
 * headers.append(
 *   'Set-Cookie',
 *   generateIsolatedAuthCookie({ collection: 'customers', payload, token }),
 * )
 * ```
 *
 * @throws when the collection is not one this plugin isolates — silently writing the
 * shared cookie instead would reintroduce exactly the bug the plugin exists to fix.
 */
export const generateIsolatedAuthCookie = ({
	collection,
	payload,
	token,
}: {
	collection: CollectionSlug
	payload: Payload
	token: string
}): string => {
	const entry = findEntry(payload, collection)

	if (!entry) {
		throw new Error(
			`@10x-media/dual-session: "${collection}" is not an isolated collection, so it has no cookie of its own. Use Payload's \`generatePayloadCookie\` for it, or add it to the plugin's \`collections\`.`
		)
	}

	const registered = payload.collections[collection]

	if (!registered) {
		throw new Error(`@10x-media/dual-session: collection "${collection}" is not registered.`)
	}

	return generateIsolatedCookie({
		authConfig: registered.config.auth,
		name: entry.cookieName,
		token,
	})
}
