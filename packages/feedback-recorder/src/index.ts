import { type Config, definePlugin } from 'payload'

import { normalizeOptions } from './plugin/normalizeOptions'
import { registerAdmin } from './plugin/registerAdmin'
import { registerEndpoints } from './plugin/registerEndpoints'
import { registerTranslations } from './plugin/registerTranslations'
import { setRegistry } from './plugin/registry'
import type { FeedbackRecorderPluginOptions } from './types'

export type { FeedbackRecorderPluginOptions } from './types'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/feedback-recorder': FeedbackRecorderPluginOptions
	}
}

/**
 * Lets the people using a client's CMS record their screen, talk through what they mean and send
 * it to the 10x Media system, where it lands under the client's project with the page, the
 * document and the browser it was made in. The video goes from the browser straight to Bunny;
 * everything else goes through this plugin's endpoints, which hold the site's key.
 */
export const feedbackRecorder = definePlugin<FeedbackRecorderPluginOptions>({
	slug: '@10x-media/feedback-recorder',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const resolved = normalizeOptions(options, config)
		setRegistry(config, resolved)
		registerTranslations(config, options.translations)
		registerEndpoints(config, resolved)
		registerAdmin(config, resolved)
		return config
	},
})

export type { FeedbackRecorderPluginOptions as PluginOptions }
