import type { CollectionConfig, Config } from 'payload'

import type { DualSessionPluginOptions, ResolvedIsolatedCollection } from '../types'
import { resolveCollections } from './resolveCollections'

/**
 * The slug Payload will treat as the admin panel's user collection.
 *
 * Mirrors `sanitizeConfig`: an explicit `admin.user` wins, otherwise the first collection
 * declaring `auth`, otherwise the `users` collection core appends for you. Guessing
 * `'users'` outright would miss the case the check exists for: a project whose admin
 * collection is named something else and never set `admin.user`, where isolating it would
 * take the admin panel down.
 */
export const resolveAdminUserSlug = (config: Config): string =>
	config.admin?.user ??
	(config.collections ?? []).find(({ auth }) => Boolean(auth))?.slug ??
	'users'

/**
 * Picks the collections this plugin will actually isolate, dropping the ones it cannot.
 *
 * Plugins run before `sanitizeConfig` and in array order, so a collection contributed by a
 * later plugin is genuinely absent here. That is a load-order problem, not a broken config,
 * and refusing to boot over it would be worse than saying so and moving on. Isolating the
 * admin collection wholesale stays fatal: it is the one mistake that silently breaks the
 * admin panel.
 *
 * Warnings are returned rather than logged: `payload.logger` does not exist while the config
 * is being built, so the caller replays them from `onInit`.
 */
export const selectCollections = ({
	adminUserSlug,
	collections,
	cookiePrefix,
	incoming,
}: {
	adminUserSlug: string
	collections: DualSessionPluginOptions['collections']
	cookiePrefix: string
	incoming: CollectionConfig[]
}): { collections: ResolvedIsolatedCollection[]; warnings: string[] } => {
	const resolved = resolveCollections({ collections, cookiePrefix })
	const warnings: string[] = []
	const adminEntry = resolved.find(({ slug }) => slug === adminUserSlug)

	if (adminEntry && !adminEntry.isolate) {
		throw new Error(
			`@10x-media/dual-session: "${adminUserSlug}" backs the admin panel and owns the shared "${cookiePrefix}-token" cookie, so isolating all of it takes the admin panel down. Give the entry an \`isolate\` predicate to move only some of its users onto a second cookie, or list the other auth collections instead.`
		)
	}

	if (adminEntry?.scopes.includes('admin')) {
		// The isolated strategy runs ahead of core's `local-jwt`, so an isolated cookie that
		// is allowed to answer admin-scoped requests would outrank the admin's own shared
		// cookie on the very collection the panel authenticates against.
		throw new Error(
			`@10x-media/dual-session: "${adminUserSlug}" backs the admin panel, so its isolated cookie must not carry the "admin" scope. It would shadow the admin session it is supposed to sit beside. Use \`scopes: ['frontend']\`.`
		)
	}

	const selected = resolved.filter(({ slug }) => {
		const collection = incoming.find((entry) => entry.slug === slug)

		if (!collection) {
			warnings.push(
				`@10x-media/dual-session: collection "${slug}" is not in the config, so it was skipped. If another plugin adds it, list dualSession after that plugin.`
			)
			return false
		}

		if (!collection.auth) {
			warnings.push(
				`@10x-media/dual-session: collection "${slug}" does not have auth enabled, so it was skipped.`
			)
			return false
		}

		if (collection.endpoints === false) {
			// Kept, not skipped: core answers 501 for every route on such a collection with or
			// without this plugin, and a custom login route can still mint the isolated cookie.
			warnings.push(
				`@10x-media/dual-session: collection "${slug}" sets "endpoints: false", so it has no REST auth routes to shadow. Sessions for it can only be established outside REST, via generateIsolatedAuthCookie.`
			)
		}

		return true
	})

	return { collections: selected, warnings }
}
