import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.gridView]: 'Afficher en grille',
	[keys.listView]: 'Afficher en liste',
	[keys.orderLabel]: 'Ordre',
	[keys.pickManyHint]:
		'Maintenez {{modifier}} pour en sélectionner plusieurs, {{range}} pour une plage.',
	[keys.pluginName]: 'Sélecteur de dossiers',
	[keys.retry]: 'Réessayer',
	[keys.sortByLabel]: 'Trier par',
}
