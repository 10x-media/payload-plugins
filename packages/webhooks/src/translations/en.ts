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
		'Used to sign deliveries. Stored encrypted and never shown again once saved, so copy it to the receiver now; if you lose it, rotate rather than hunt for it.',
	[keys.fieldPreviousSecretExpires]: 'Previous secret valid until',
	[keys.fieldPreviousSecretExpiresHelp]:
		'While set, deliveries carry a signature from both the current and the previous secret. After this time only the current one signs.',
	[keys.rotateSecret]: 'Rotate secret',
	[keys.rotateSecretTitle]: 'Rotate signing secret',
	[keys.rotateSecretCancel]: 'Cancel',
	[keys.rotateSecretAcknowledge]: "I've saved it",
	[keys.rotateSecretCopy]: 'Copy',
	[keys.rotateSecretCopied]: 'Copied',
	[keys.rotateSecretCopyFailed]: 'Could not copy automatically. Select the secret and copy it.',
	[keys.rotateSecretRevealTitle]: 'New signing secret',
	[keys.rotateSecretRevealBody]:
		'This is the only time this secret is shown. Copy it into your receiver before closing this dialog.',
	[keys.rotateSecretDone]: 'Secret rotated',
	[keys.rotateSecretFailed]: 'Could not rotate the secret',
	[keys.rotateSecretConfirm]:
		'Rotate this signing secret? The current one keeps working for the grace period, then stops. You will see the new secret once.',
	[keys.rotateSecretForbidden]: 'You do not have permission to rotate this secret',
	[keys.rotateSecretConflict]:
		'This subscription changed while rotating. Reload and try again if you still need a new secret',
	[keys.rotateSecretRejected]: 'The rotation was rejected. Check the secret you supplied',
	[keys.fieldHeaders]: 'Custom headers',
	[keys.headerReserved]:
		"'{{name}}' is set by the plugin on every delivery and cannot be overridden.",
	[keys.headerInvalid]:
		"'{{name}}' is not a valid HTTP header name. Use letters, digits, and any of !#$%&'*+-.^_`|~ with no spaces.",
	[keys.fieldDescription]: 'Description',
	[keys.statusPending]: 'Pending',
	[keys.statusSuccess]: 'Delivered',
	[keys.statusFailed]: 'Failed',
	[keys.statusDead]: 'Dead',
	[keys.redeliver]: 'Redeliver',
	[keys.redeliverDone]: 'Redelivery queued',
}
