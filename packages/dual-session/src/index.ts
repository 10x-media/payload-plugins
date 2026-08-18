import { type CollectionConfig, type Config, definePlugin } from 'payload'

import { AUTH_SCOPE_HEADER, PLUGIN_SLUG } from './constants'
import { buildIsolatedAuthEndpoints } from './endpoints'
import { registerTranslations } from './plugin/registerTranslations'
import { resolveAdminUserSlug, selectCollections } from './plugin/selectCollections'
import { createIsolatedAuthStrategy } from './strategy'
import type { DualSessionPluginOptions } from './types'

export { AUTH_SCOPE_HEADER, PLUGIN_SLUG } from './constants'
export { generateIsolatedCookie, getIsolatedCookieName } from './cookies'
export { generateIsolatedAuthCookie, resolveIsolatedCookieName } from './runtime'
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
	slug: PLUGIN_SLUG,
	plugin: ({ config: incomingConfig, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return incomingConfig
		}

		const cookiePrefix = incomingConfig.cookiePrefix ?? 'payload'
		const scopeHeader = options.scopeHeader ?? AUTH_SCOPE_HEADER
		const adminSessionPriority = options.adminSessionPriority ?? true
		const incomingCollections = incomingConfig.collections ?? []

		const { collections: isolated, warnings } = selectCollections({
			adminUserSlug: resolveAdminUserSlug(incomingConfig),
			collections: options.collections,
			cookiePrefix,
			incoming: incomingCollections,
		})

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

		const config: Config = { ...incomingConfig, collections }

		if (warnings.length > 0) {
			// `payload.logger` only exists once Payload has booted, so a config-time problem
			// has to wait for onInit to be reported through the project's own logger.
			const priorOnInit = incomingConfig.onInit
			config.onInit = async (payload) => {
				for (const warning of warnings) {
					payload.logger.warn(warning)
				}
				await priorOnInit?.(payload)
			}
		}

		return config
	},
})
