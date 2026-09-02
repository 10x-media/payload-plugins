import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.gridView]: 'Mostrar em grelha',
	[keys.listView]: 'Mostrar em lista',
	[keys.orderLabel]: 'Ordem',
	[keys.pickManyHint]:
		'Mantenha {{modifier}} premido para selecionar mais de um, {{range}} para selecionar um intervalo.',
	[keys.pluginName]: 'Seletor de pastas',
	[keys.retry]: 'Tentar novamente',
	[keys.sortByLabel]: 'Ordenar por',
}
