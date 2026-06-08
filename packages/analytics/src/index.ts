import { type Config, definePlugin } from 'payload'

import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry } from './core/registry'
import { registerTranslations } from './plugin/registerTranslations'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/analytics': AnalyticsPluginOptions
	}
}

export const analytics = definePlugin<AnalyticsPluginOptions>({
	slug: '@10x-media/analytics',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const resolved = resolveOptions(options)
		registerTranslations(config)
		createRegistry(resolved.adapters, resolved.defaultAdapter)
		return config
	},
})

export type {
	AnalyticsPluginOptions,
	AnalyticsPluginOptions as PluginOptions,
} from './core/options'
