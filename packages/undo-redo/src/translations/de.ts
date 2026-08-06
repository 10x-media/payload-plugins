import { keys, type TranslationKey } from './keys'

/** German values, keyed by the typed constants in `keys.ts`. */
export const de: Record<TranslationKey, string> = {
	[keys.undo]: 'Rückgängig',
	[keys.undoTooltip]: 'Rückgängig machen (Strg+Z)',
	[keys.redo]: 'Wiederholen',
	[keys.redoTooltip]: 'Wiederholen (Strg+Umschalt+Z)',
}
