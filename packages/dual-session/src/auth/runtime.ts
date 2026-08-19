import type { CollectionSlug, Payload, TypedUser } from 'payload'

import { PLUGIN_SLUG } from '../plugin/constants'
import { resolveCollections } from '../plugin/resolveCollections'
import type { DualSessionPluginOptions, ResolvedIsolatedCollection } from '../types'
import { generateIsolatedCookie, getSharedCookieName, resolveSlotCookieName } from './cookies'

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
 * Asks an entry which cookie a session belongs in, refusing to guess when it cannot know.
 *
 * An entry carrying an `isolate` predicate splits its collection's users across two
 * cookies, so answering without the user would be a coin flip that silently signs someone
 * into the wrong session. Better to say so.
 */
const slotFor = ({
	collection,
	entry,
	payload,
	user,
}: {
	collection: CollectionSlug
	entry: ResolvedIsolatedCollection
	payload: Payload
	user: null | TypedUser | undefined
}): string => {
	if (!entry.isolate) {
		return entry.cookieName
	}

	if (!user) {
		throw new Error(
			`@10x-media/dual-session: "${collection}" splits its users across two cookies with an \`isolate\` predicate, so the user has to be passed for the right one to be picked.`
		)
	}

	return resolveSlotCookieName({
		entry,
		sharedName: getSharedCookieName(payload.config.cookiePrefix),
		user,
	}) as string
}

/**
 * The cookie name this collection's sessions live in, or `undefined` when the collection
 * is not isolated (and therefore still uses the shared `${cookiePrefix}-token`).
 *
 * Resolved from the plugin's registered options rather than recomputed, so a `cookieName`
 * override is honoured and callers never hardcode the name.
 *
 * @throws when the collection has an `isolate` predicate and no `user` is passed, because
 * then the name is a function of the user rather than of the collection.
 */
export const resolveIsolatedCookieName = ({
	collection,
	payload,
	user,
}: {
	collection: CollectionSlug
	payload: Payload
	/** Required when the collection is configured with an `isolate` predicate. */
	user?: null | TypedUser
}): string | undefined => {
	const entry = findEntry(payload, collection)

	return entry ? slotFor({ collection, entry, payload, user }) : undefined
}

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
 * Pass `user` whenever the collection is configured with an `isolate` predicate: there the
 * cookie is a function of the user, and the call throws rather than pick one blindly.
 *
 * @throws when the collection is not one this plugin isolates — silently writing the
 * shared cookie instead would reintroduce exactly the bug the plugin exists to fix.
 */
export const generateIsolatedAuthCookie = ({
	collection,
	payload,
	token,
	user,
}: {
	collection: CollectionSlug
	payload: Payload
	token: string
	/** Required when the collection is configured with an `isolate` predicate. */
	user?: null | TypedUser
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
		name: slotFor({ collection, entry, payload, user }),
		token,
	})
}
