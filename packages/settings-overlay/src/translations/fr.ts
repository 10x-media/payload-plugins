import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Panneau de réglages',
	[keys.appearanceLabel]: 'Apparence',
	[keys.back]: 'Retour',
	[keys.close]: 'Fermer',
	[keys.delete]: 'Supprimer',
	[keys.deleteBody]: 'Ce document sera supprimé définitivement. Cette action est irréversible.',
	[keys.deleteConfirm]: 'Supprimer',
	[keys.deleteHeading]: 'Supprimer le document ?',
	[keys.deleted]: 'Document supprimé',
	[keys.discardBody]:
		'Des modifications ne sont pas enregistrées. Quitter maintenant les abandonnera.',
	[keys.discardConfirm]: 'Abandonner les modifications',
	[keys.discardHeading]: 'Abandonner les modifications ?',
	[keys.empty]: 'Rien à afficher ici pour le moment.',
	[keys.loadFailed]: 'Le chargement a échoué. Veuillez réessayer.',
	[keys.noResults]: 'Aucun résultat.',
	[keys.searchPlaceholder]: 'Rechercher',
}
