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
		'Generated once on create. Used to sign deliveries; store it on the receiver.',
	[keys.fieldHeaders]: 'Custom headers',
	[keys.fieldDescription]: 'Description',
	[keys.statusPending]: 'Pending',
	[keys.statusSuccess]: 'Delivered',
	[keys.statusFailed]: 'Failed',
	[keys.statusDead]: 'Dead',
	[keys.redeliver]: 'Redeliver',
	[keys.redeliverDone]: 'Redelivery queued',
}
