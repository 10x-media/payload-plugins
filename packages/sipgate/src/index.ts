import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'

export type SipgatePluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/sipgate': SipgatePluginOptions
	}
}

/**
 * Sipgate plugin for Payload v3. Currently registers this plugin's
 * translations; future releases will add feature behavior. Authored with
 * `definePlugin` so sibling plugins can detect it by slug.
 */
export const sipgate = definePlugin<SipgatePluginOptions>({
	slug: '@10x-media/sipgate',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config)
		return config
	},
})

export type { SipgatePluginOptions as PluginOptions }
