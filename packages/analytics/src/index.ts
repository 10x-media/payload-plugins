import type { Config, Plugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'

export interface AnalyticsOptions {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
}

/**
 * Analytics plugin for Payload v3. Currently registers this plugin's
 * translations; future releases will add feature behavior.
 */
export const analytics =
	(options: AnalyticsOptions = {}): Plugin =>
	(incoming: Config): Config => {
		if (options.disabled === true) {
			return incoming
		}
		registerTranslations(incoming)
		return incoming
	}

export type { AnalyticsOptions as PluginOptions }
