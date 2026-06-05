/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals. Every key here must have a value in every locale (`en.ts`), or it is
 * a type error.
 */
export const keys = {
	pluginName: 'webhooks:pluginName',
	adminGroup: 'webhooks:adminGroup',
	subscriptionSingular: 'webhooks:subscriptionSingular',
	subscriptionPlural: 'webhooks:subscriptionPlural',
	deliverySingular: 'webhooks:deliverySingular',
	deliveryPlural: 'webhooks:deliveryPlural',
	fieldName: 'webhooks:fieldName',
	fieldUrl: 'webhooks:fieldUrl',
	fieldEnabled: 'webhooks:fieldEnabled',
	fieldEvents: 'webhooks:fieldEvents',
	fieldSecret: 'webhooks:fieldSecret',
	fieldSecretHelp: 'webhooks:fieldSecretHelp',
	fieldHeaders: 'webhooks:fieldHeaders',
	fieldDescription: 'webhooks:fieldDescription',
	statusPending: 'webhooks:statusPending',
	statusSuccess: 'webhooks:statusSuccess',
	statusFailed: 'webhooks:statusFailed',
	statusDead: 'webhooks:statusDead',
	redeliver: 'webhooks:redeliver',
	redeliverDone: 'webhooks:redeliverDone',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
