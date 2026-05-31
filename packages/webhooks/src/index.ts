import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'

export type WebhooksPluginOptions = {
	/** Disable the plugin entirely (incoming config returned untouched). */
	disabled?: boolean
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/webhooks': WebhooksPluginOptions
	}
}

/** The trigger slug webhooks contributes to the automations catalog. */
export const WEBHOOK_TRIGGER_SLUG = 'webhook' as const

/**
 * Webhooks plugin for Payload v3. Runs before automations (`order: 10`) so it can
 * push its `webhook` trigger into automations' options when that plugin is
 * present. The contribution is decoupled: webhooks references automations only by
 * slug and never imports it, so it composes when automations is installed and is
 * a no-op when it is not. For Phase 0 the contribution is all this does; delivery,
 * subscriptions, and incoming verification are built in a later phase.
 */
export const webhooks = definePlugin<WebhooksPluginOptions>({
	slug: '@10x-media/webhooks',
	order: 10,
	plugin: ({ config, plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config)

		const automationsPlugin = plugins['@10x-media/automations']
		if (automationsPlugin?.options) {
			const opts = automationsPlugin.options as { triggers?: string[] }
			opts.triggers = [...(opts.triggers ?? []), WEBHOOK_TRIGGER_SLUG]
		}

		return config
	},
})

export type { WebhooksPluginOptions as PluginOptions }
