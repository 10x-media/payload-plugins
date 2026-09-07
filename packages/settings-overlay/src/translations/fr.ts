import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Panneau de réglages',
	[keys.appearanceLabel]: 'Apparence',
	[keys.back]: 'Retour',
	[keys.close]: 'Fermer',
	[keys.discardBody]:
		'Des modifications ne sont pas enregistrées. Quitter maintenant les abandonnera.',
	[keys.discardConfirm]: 'Abandonner les modifications',
	[keys.discardHeading]: 'Abandonner les modifications ?',
	[keys.empty]: 'Rien à afficher ici pour le moment.',
	[keys.loadFailed]: 'Le chargement a échoué. Veuillez réessayer.',
	[keys.noResults]: 'Aucun résultat.',
	[keys.searchPlaceholder]: 'Rechercher',
	[keys.widgetNotice]:
		'Ce widget ne peut pas être affiché. Vous pouvez le retirer du tableau de bord.',
}
