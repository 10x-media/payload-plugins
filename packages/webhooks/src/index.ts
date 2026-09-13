import { type Config, definePlugin } from 'payload'

import type { WebhooksPluginOptions } from './options'
import { registerTranslations } from './plugin/registerTranslations'
import { registerWebhooks } from './plugin/registerWebhooks'

export { GENERATED_SECRET_KEY } from './constants'
export type {
	CollectionOverride,
	FieldsOverride,
	SecretEncryptionOptions,
	WebhooksPluginOptions,
} from './options'
export type {
	EncryptExistingSecretsOptions,
	SecretMigrationReport,
} from './secrets/encryptExistingSecrets'
export { encryptExistingSecrets } from './secrets/encryptExistingSecrets'
export { InvalidSecretError } from './secrets/format'
export type { RotateSecretResult } from './secrets/rotate'
export { rotateSubscriptionSecret } from './secrets/rotate'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/webhooks': WebhooksPluginOptions
	}
}

/** The trigger slug webhooks contributes to the automations catalog. */
export const WEBHOOK_TRIGGER_SLUG = 'webhook' as const

/**
 * Webhooks plugin for Payload v3. Runs before automations (`order: 10`) so it can
 * push its `webhook` trigger into automations when present, and builds outbound
 * delivery: opt-in collections emit signed HTTP POSTs to subscribed endpoints,
 * delivered via native Payload jobs or bounded-await inline.
 */
export const webhooks = definePlugin<WebhooksPluginOptions>({
	slug: '@10x-media/webhooks',
	order: 10,
	plugin: ({ config, plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)

		const automationsPlugin = plugins['@10x-media/automations']
		if (automationsPlugin?.options) {
			const opts = automationsPlugin.options as { triggers?: string[] }
			opts.triggers = [...(opts.triggers ?? []), WEBHOOK_TRIGGER_SLUG]
		}

		registerWebhooks({ config, options, hasJobsPlugin: Boolean(plugins['@10x-media/jobs']) })

		return config
	},
})

export type { WebhooksPluginOptions as PluginOptions } from './options'
