import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Abonnement',
	[keys.subscriptionPlural]: 'Abonnements',
	[keys.deliverySingular]: 'Livraison',
	[keys.deliveryPlural]: 'Livraisons',
	[keys.fieldName]: 'Nom',
	[keys.fieldUrl]: "URL de l'endpoint",
	[keys.urlInvalid]: 'Saisissez une URL absolue en http:// ou https://.',
	[keys.fieldEnabled]: 'Activé',
	[keys.fieldEvents]: 'Événements',
	[keys.fieldSecret]: 'Secret de signature',
	[keys.fieldSecretHelp]:
		"Sert à signer les livraisons. Il est stocké chiffré et n'est plus jamais affiché après l'enregistrement, copiez-le donc maintenant vers le destinataire. Si vous le perdez, renouvelez-le plutôt que de le chercher.",
	[keys.fieldPreviousSecretExpires]: "Secret précédent valide jusqu'au",
	[keys.fieldPreviousSecretExpiresHelp]:
		'Tant que cette date est définie, les livraisons portent une signature du secret actuel et une du précédent. Passé ce moment, seul le secret actuel signe.',
	[keys.rotateSecret]: 'Renouveler le secret',
	[keys.rotateSecretTitle]: 'Renouveler le secret de signature',
	[keys.rotateSecretAcknowledge]: "Je l'ai enregistré",
	[keys.rotateSecretCopy]: 'Copier',
	[keys.rotateSecretCopied]: 'Copié',
	[keys.rotateSecretCopyFailed]:
		'Copie automatique impossible. Sélectionnez le secret et copiez-le.',
	[keys.rotateSecretRevealTitle]: 'Nouveau secret de signature',
	[keys.rotateSecretRevealBody]:
		"C'est la seule fois que ce secret est affiché. Copiez-le dans votre destinataire avant de fermer cette fenêtre.",
	[keys.rotateSecretDone]: 'Secret renouvelé',
	[keys.rotateSecretFailed]: 'Impossible de renouveler le secret',
	[keys.rotateSecretConfirm]:
		"Renouveler ce secret de signature ? Le secret actuel reste valable pendant le délai de grâce, puis cesse de fonctionner. Le nouveau secret ne vous sera montré qu'une fois.",
	[keys.rotateSecretForbidden]: "Vous n'avez pas la permission de renouveler ce secret",
	[keys.rotateSecretConflict]:
		"Cet abonnement a changé pendant le renouvellement. Rechargez et réessayez si vous avez toujours besoin d'un nouveau secret",
	[keys.rotateSecretRejected]: 'Le renouvellement a été refusé. Vérifiez le secret fourni',
	[keys.fieldHeaders]: 'En-têtes personnalisés',
	[keys.headerReserved]:
		"'{{name}}' est défini par le plugin à chaque livraison et ne peut pas être remplacé.",
	[keys.headerInvalid]:
		"'{{name}}' n'est pas un nom d'en-tête HTTP valide. Utilisez des lettres, des chiffres et les caractères !#$%&'*+-.^_`|~, sans espace.",
	[keys.headerValueInvalid]: "La valeur d'un en-tête ne peut pas contenir de saut de ligne.",
	[keys.fieldDescription]: 'Description',
	[keys.statusPending]: 'En attente',
	[keys.statusSuccess]: 'Livrée',
	[keys.statusFailed]: 'Échouée',
	[keys.statusDead]: 'Abandonnée',
	[keys.redeliver]: 'Relivrer',
	[keys.redeliverDone]: 'Nouvelle livraison mise en file',
	[keys.redeliverFailed]: 'Impossible de relivrer',
	[keys.redeliverConfirm]:
		'Renvoyer cette charge utile ? Elle part comme une nouvelle livraison avec un nouveau webhook-id, un destinataire qui déduplique sur cet identifiant la traitera donc une seconde fois.',
}
