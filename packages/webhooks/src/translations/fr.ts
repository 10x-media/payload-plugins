import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Abonnement',
	[keys.subscriptionPlural]: 'Abonnements',
	[keys.deliverySingular]: 'Livraison',
	[keys.deliveryPlural]: 'Livraisons',
	[keys.fieldName]: 'Nom',
	[keys.fieldUrl]: "URL de l'endpoint",
	[keys.fieldEnabled]: 'Activé',
	[keys.fieldEvents]: 'Événements',
	[keys.fieldSecret]: 'Secret de signature',
	[keys.fieldSecretHelp]:
		'Affiché en entier une seule fois à la création, masqué ensuite. Il signe les livraisons, copiez-le maintenant vers le destinataire.',
	[keys.fieldHeaders]: 'En-têtes personnalisés',
	[keys.fieldDescription]: 'Description',
	[keys.statusPending]: 'En attente',
	[keys.statusSuccess]: 'Livrée',
	[keys.statusFailed]: 'Échouée',
	[keys.statusDead]: 'Abandonnée',
	[keys.redeliver]: 'Relivrer',
	[keys.redeliverDone]: 'Nouvelle livraison mise en file',
}
