import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.gridView]: 'Показать сеткой',
	[keys.listView]: 'Показать списком',
	[keys.orderLabel]: 'Порядок',
	[keys.pickManyHint]:
		'Удерживайте {{modifier}}, чтобы выбрать несколько, {{range}} для диапазона.',
	[keys.pluginName]: 'Выбор папки',
	[keys.retry]: 'Попробовать ещё раз',
	[keys.sortByLabel]: 'Сортировать по',
}
