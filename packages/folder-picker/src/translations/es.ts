import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.gridView]: 'Mostrar en cuadrícula',
	[keys.listView]: 'Mostrar en lista',
	[keys.orderLabel]: 'Orden',
	[keys.pickManyHint]:
		'Mantenga pulsado {{modifier}} para seleccionar varios, {{range}} para un rango.',
	[keys.pluginName]: 'Selector de carpetas',
	[keys.retry]: 'Reintentar',
	[keys.sortByLabel]: 'Ordenar por',
}
