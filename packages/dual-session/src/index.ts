import { type CollectionConfig, type Config, definePlugin } from 'payload'

import { AUTH_SCOPE_HEADER } from './constants'
import { buildIsolatedAuthEndpoints } from './endpoints'
import { registerTranslations } from './plugin/registerTranslations'
import { resolveCollections } from './plugin/resolveCollections'
import { createIsolatedAuthStrategy } from './strategy'
import type { DualSessionPluginOptions } from './types'

export { AUTH_SCOPE_HEADER } from './constants'
export { getIsolatedCookieName } from './cookies'
export { resolveAuthScope } from './scope'
export type {
	AuthScope,
	DualSessionPluginOptions,
	DualSessionPluginOptions as PluginOptions,
	IsolatedCollection,
} from './types'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/dual-session': DualSessionPluginOptions
	}
}

/**
 * Moves the listed auth collections off Payload's single, config-wide
 * `${cookiePrefix}-token` cookie and onto their own cookies, so a login on the website
 * and a login in the admin panel can coexist.
 *
 * Payload signs every collection's token into that one shared cookie, so a frontend
 * login overwrites the admin panel's session and vice versa. This plugin gives each
 * listed collection its own cookie by:
 *
 * 1. shadowing the collection's built-in auth endpoints with replacements that read and
 *    write the scoped cookie (Payload matches collection-declared endpoints before its
 *    own built-ins), and
 * 2. registering an auth strategy on the collection that authenticates from that cookie.
 *
 * The admin collection (`admin.user`) keeps the shared cookie and is left untouched.
 *
 * For `req.user` to be fully deterministic, pair this with the auth-scope proxy —
 * see `@10x-media/dual-session/proxy`.
 */
export const dualSession = definePlugin<DualSessionPluginOptions>({
	slug: '@10x-media/dual-session',
	plugin: ({ config: incomingConfig, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return incomingConfig
		}

		const cookiePrefix = incomingConfig.cookiePrefix ?? 'payload'
		const adminUserSlug = incomingConfig.admin?.user ?? 'users'
		const scopeHeader = options.scopeHeader ?? AUTH_SCOPE_HEADER
		const adminSessionPriority = options.adminSessionPriority ?? true

		const isolated = resolveCollections({ collections: options.collections, cookiePrefix })

		if (isolated.some(({ slug }) => slug === adminUserSlug)) {
			throw new Error(
				`@10x-media/dual-session: "${adminUserSlug}" backs the admin panel and owns the shared "${cookiePrefix}-token" cookie. Isolate the other auth collections instead.`
			)
		}

		const incomingCollections = incomingConfig.collections ?? []

		for (const { slug } of isolated) {
			const collection = incomingCollections.find((entry) => entry.slug === slug)

			if (!collection) {
				throw new Error(`@10x-media/dual-session: collection "${slug}" is not in the config.`)
			}

			if (!collection.auth) {
				throw new Error(`@10x-media/dual-session: collection "${slug}" does not have auth enabled.`)
			}
		}

		const collections: CollectionConfig[] = incomingCollections.map((collection) => {
			const match = isolated.find(({ slug }) => slug === collection.slug)
			if (!match) {
				return collection
			}

			const auth = typeof collection.auth === 'object' ? collection.auth : {}
			const strategy = createIsolatedAuthStrategy({
				adminSessionPriority,
				cookieName: match.cookieName,
				// Everything listed before this collection outranks it.
				higherPriority: isolated
					.slice(0, isolated.indexOf(match))
					.map(({ cookieName, slug }) => ({ cookieName, slug })),
				scopeHeader,
				scopes: match.scopes,
				slug: match.slug,
			})

			return {
				...collection,
				auth: {
					...auth,
					strategies: [...(auth.strategies ?? []), strategy],
				},
				endpoints:
					collection.endpoints === false
						? false
						: [
								...buildIsolatedAuthEndpoints({
									cookieName: match.cookieName,
									slug: match.slug,
								}),
								...(collection.endpoints ?? []),
							],
			}
		})

		registerTranslations(incomingConfig, options.translations)

		return { ...incomingConfig, collections }
	},
})
