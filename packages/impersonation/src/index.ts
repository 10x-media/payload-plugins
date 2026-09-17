import { type Config, definePlugin } from 'payload'

import { getImpersonation } from './getImpersonation'
import { assertHookedAuthCollections } from './plugin/assertTargets'
import { PLUGIN_SLUG } from './plugin/constants'
import { decorateAuthStrategies } from './plugin/decorateAuth'
import { normalizeOptions } from './plugin/normalizeOptions'
import { registerAdmin } from './plugin/registerAdmin'
import { registerCollection } from './plugin/registerCollection'
import { registerEndpoints } from './plugin/registerEndpoints'
import { registerHooks } from './plugin/registerHooks'
import { registerTranslations } from './plugin/registerTranslations'
import { setRegistry } from './plugin/registry'
import { closeStaleImpersonations } from './session/closeStale'
import type { ImpersonationPluginOptions } from './types'

export type { ImpersonationStatus } from './getImpersonation'
export { PLUGIN_SLUG } from './plugin/constants'
export type {
	ImpersonationPluginOptions,
	ImpersonationPluginOptions as PluginOptions,
} from './types'
export { closeStaleImpersonations, getImpersonation }

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/impersonation': ImpersonationPluginOptions
	}
}

/**
 * Let an authorised account sign in as another user without their password.
 * After start, `req.user` is the target. Every session is a closed-never-deleted
 * row. Access is always a host function; the plugin never compares roles.
 */
export const impersonation = definePlugin<ImpersonationPluginOptions>({
	slug: PLUGIN_SLUG,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}

		const resolved = normalizeOptions(options, config)
		const hookedAuthSlugs = (config.collections ?? [])
			.filter((collection) => Boolean(collection.auth))
			.map(({ slug }) => slug)
		registerTranslations(config, options.translations)
		setRegistry(config, resolved)
		registerCollection(config, resolved)
		registerEndpoints(config, resolved)
		registerHooks(config, resolved)
		registerAdmin(config, resolved)

		const priorOnInit = config.onInit
		config.onInit = async (payload) => {
			assertHookedAuthCollections(payload, resolved, hookedAuthSlugs)

			if (resolved.maxDuration === undefined) {
				payload.logger.warn(
					'@10x-media/impersonation: maxDuration is unset. An impersonation never expires on its own because refresh keeps extending the minted session.'
				)
			}

			if (resolved.decorateRequests) {
				decorateAuthStrategies(payload, resolved)
			}

			try {
				await closeStaleImpersonations(payload)
			} catch (error) {
				payload.logger.error({
					err: error,
					msg: '@10x-media/impersonation: closeStaleImpersonations failed during onInit',
				})
			}

			await priorOnInit?.(payload)
		}

		return config
	},
})
