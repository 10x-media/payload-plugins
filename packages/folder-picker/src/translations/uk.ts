import { keys, type TranslationKey } from './keys'

/**
 * Ukrainian values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error.
 */
export const uk: Record<TranslationKey, string> = {
	[keys.gridView]: 'Показати сіткою',
	[keys.listView]: 'Показати списком',
	[keys.orderLabel]: 'Порядок',
	[keys.pickManyHint]: 'Утримуйте {{modifier}}, щоб вибрати кілька, {{range}} для діапазону.',
	[keys.pluginName]: 'Вибір теки',
	[keys.retry]: 'Спробувати ще раз',
	[keys.sortByLabel]: 'Сортувати за',
}
