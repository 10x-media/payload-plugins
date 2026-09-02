import { keys, type TranslationKey } from './keys'

export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Abonnement',
	[keys.subscriptionPlural]: 'Abonnements',
	[keys.deliverySingular]: 'Zustellung',
	[keys.deliveryPlural]: 'Zustellungen',
	[keys.fieldName]: 'Name',
	[keys.fieldUrl]: 'Endpoint-URL',
	[keys.fieldEnabled]: 'Aktiviert',
	[keys.fieldEvents]: 'Ereignisse',
	[keys.fieldSecret]: 'Signaturgeheimnis',
	[keys.fieldSecretHelp]:
		'Wird beim Anlegen einmal vollständig angezeigt, danach maskiert. Es signiert die Zustellungen, kopieren Sie es jetzt zum Empfänger.',
	[keys.fieldHeaders]: 'Eigene Header',
	[keys.fieldDescription]: 'Beschreibung',
	[keys.statusPending]: 'Ausstehend',
	[keys.statusSuccess]: 'Zugestellt',
	[keys.statusFailed]: 'Fehlgeschlagen',
	[keys.statusDead]: 'Aufgegeben',
	[keys.redeliver]: 'Erneut zustellen',
	[keys.redeliverDone]: 'Erneute Zustellung eingereiht',
}
