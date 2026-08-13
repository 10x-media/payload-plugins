import { keys, type TranslationKey } from './keys'

/**
 * German values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error.
 */
export const de: Record<TranslationKey, string> = {
	[keys.gridView]: 'Als Raster anzeigen',
	[keys.listView]: 'Als Liste anzeigen',
	[keys.orderLabel]: 'Reihenfolge',
	[keys.pickManyHint]: '{{modifier}} halten, um mehrere auszuwählen, {{range}} für einen Bereich.',
	[keys.pluginName]: 'Ordnerauswahl',
	[keys.retry]: 'Erneut versuchen',
	[keys.sortByLabel]: 'Sortieren nach',
}
