/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals. Every key here must have a value in every locale (`en.ts`), or it is
 * a type error.
 */
export const keys = {
	pluginName: 'webhooks:pluginName',
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
	fieldPreviousSecretExpires: 'webhooks:fieldPreviousSecretExpires',
	fieldPreviousSecretExpiresHelp: 'webhooks:fieldPreviousSecretExpiresHelp',
	rotateSecret: 'webhooks:rotateSecret',
	rotateSecretCancel: 'webhooks:rotateSecretCancel',
	rotateSecretAcknowledge: 'webhooks:rotateSecretAcknowledge',
	rotateSecretCopy: 'webhooks:rotateSecretCopy',
	rotateSecretCopied: 'webhooks:rotateSecretCopied',
	rotateSecretCopyFailed: 'webhooks:rotateSecretCopyFailed',
	rotateSecretRevealTitle: 'webhooks:rotateSecretRevealTitle',
	rotateSecretRevealBody: 'webhooks:rotateSecretRevealBody',
	rotateSecretTitle: 'webhooks:rotateSecretTitle',
	rotateSecretDone: 'webhooks:rotateSecretDone',
	rotateSecretFailed: 'webhooks:rotateSecretFailed',
	rotateSecretConfirm: 'webhooks:rotateSecretConfirm',
	rotateSecretForbidden: 'webhooks:rotateSecretForbidden',
	rotateSecretConflict: 'webhooks:rotateSecretConflict',
	rotateSecretRejected: 'webhooks:rotateSecretRejected',
	fieldHeaders: 'webhooks:fieldHeaders',
	headerReserved: 'webhooks:headerReserved',
	headerInvalid: 'webhooks:headerInvalid',
	fieldDescription: 'webhooks:fieldDescription',
	statusPending: 'webhooks:statusPending',
	statusSuccess: 'webhooks:statusSuccess',
	statusFailed: 'webhooks:statusFailed',
	statusDead: 'webhooks:statusDead',
	redeliver: 'webhooks:redeliver',
	redeliverDone: 'webhooks:redeliverDone',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
