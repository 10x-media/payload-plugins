import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.gridView]: 'Show as grid',
	[keys.listView]: 'Show as list',
	[keys.orderLabel]: 'Order',
	[keys.pickManyHint]: 'Hold {{modifier}} to pick more than one, {{range}} to pick a range.',
	[keys.pluginName]: 'Folder Picker',
	[keys.retry]: 'Try again',
	[keys.sortByLabel]: 'Sort by',
}
