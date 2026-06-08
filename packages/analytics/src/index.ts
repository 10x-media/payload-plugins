import type { Config, Plugin } from 'payload'

import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry } from './core/registry'
import { registerTranslations } from './plugin/registerTranslations'

export const analytics =
	(options: AnalyticsPluginOptions | false): Plugin =>
	(incoming: Config): Config => {
		if (options === false) {
			return incoming
		}
		const resolved = resolveOptions(options)
		registerTranslations(incoming)
		createRegistry(resolved.adapters, resolved.defaultAdapter)
		return incoming
	}

export type {
	AnalyticsPluginOptions,
	AnalyticsPluginOptions as PluginOptions,
} from './core/options'
