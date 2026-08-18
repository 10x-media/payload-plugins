import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts`. The
 * `Record<TranslationKey, string>` annotation makes a missing or unknown key a
 * type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Subscription',
	[keys.subscriptionPlural]: 'Subscriptions',
	[keys.deliverySingular]: 'Delivery',
	[keys.deliveryPlural]: 'Deliveries',
	[keys.fieldName]: 'Name',
	[keys.fieldUrl]: 'Endpoint URL',
	[keys.fieldEnabled]: 'Enabled',
	[keys.fieldEvents]: 'Events',
	[keys.fieldSecret]: 'Signing secret',
	[keys.fieldSecretHelp]:
		'Shown in full once on create, masked afterward. Used to sign deliveries; copy it to the receiver now.',
	[keys.fieldPreviousSecretExpires]: 'Previous secret valid until',
	[keys.fieldPreviousSecretExpiresHelp]:
		'While set, deliveries carry a signature from both the current and the previous secret. After this time only the current one signs.',
	[keys.rotateSecret]: 'Rotate secret',
	[keys.rotateSecretDone]: 'New secret, shown once. Copy it to your receiver now',
	[keys.rotateSecretFailed]: 'Could not rotate the secret',
	[keys.fieldHeaders]: 'Custom headers',
	[keys.headerReserved]:
		"'{{name}}' is set by the plugin on every delivery and cannot be overridden.",
	[keys.fieldDescription]: 'Description',
	[keys.statusPending]: 'Pending',
	[keys.statusSuccess]: 'Delivered',
	[keys.statusFailed]: 'Failed',
	[keys.statusDead]: 'Dead',
	[keys.redeliver]: 'Redeliver',
	[keys.redeliverDone]: 'Redelivery queued',
}
