import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.undo]: 'Annuler',
	[keys.redo]: 'Rétablir',
	[keys.debug]: 'Historique des annulations',
	[keys.debugTooltip]: "Inspecter l'historique des annulations",
	[keys.debugTitle]: 'Historique des annulations',
	[keys.debugEmpty]: 'Aucun historique enregistré pour le moment.',
	[keys.debugClose]: 'Fermer',
	[keys.debugPending]: 'En attente (non enregistré)',
	[keys.debugOriginal]: 'État initial',
	[keys.debugCopy]: 'Copier le JSON',
}
