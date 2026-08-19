import { type CollectionConfig, type Config, definePlugin } from 'payload'

import { buildIsolatedAuthEndpoints } from './auth/endpoints'
import { createIsolatedAuthStrategy } from './auth/strategy'
import { PLUGIN_SLUG } from './plugin/constants'
import { registerTranslations } from './plugin/registerTranslations'
import { resolveAdminUserSlug, selectCollections } from './plugin/selectCollections'
import { AUTH_SCOPE_HEADER } from './scope/resolveAuthScope'
import type { DualSessionPluginOptions } from './types'

export { generateIsolatedCookie, getIsolatedCookieName } from './auth/cookies'
export { generateIsolatedAuthCookie, resolveIsolatedCookieName } from './auth/runtime'
export { PLUGIN_SLUG } from './plugin/constants'
export { AUTH_SCOPE_HEADER, resolveAuthScope } from './scope/resolveAuthScope'
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
 * The admin collection (`admin.user`) keeps the shared cookie. It may only be listed with
 * an `isolate` predicate, which moves the users it selects onto a second cookie and leaves
 * everyone else — the admins — exactly where core put them.
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
						: [...buildIsolatedAuthEndpoints({ entry: match }), ...(collection.endpoints ?? [])],
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
