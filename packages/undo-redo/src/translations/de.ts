import { keys, type TranslationKey } from './keys'

/** German values, keyed by the typed constants in `keys.ts`. */
export const de: Record<TranslationKey, string> = {
	[keys.undo]: 'Rückgängig',
	[keys.redo]: 'Wiederholen',
	[keys.debug]: 'Rückgängig-Verlauf',
	[keys.debugTooltip]: 'Rückgängig-Verlauf untersuchen',
	[keys.debugTitle]: 'Rückgängig-Verlauf',
	[keys.debugEmpty]: 'Noch kein Verlauf erfasst.',
	[keys.debugClose]: 'Schließen',
	[keys.debugPending]: 'Ausstehend (nicht erfasst)',
	[keys.debugOriginal]: 'Ursprungszustand',
	[keys.debugCopy]: 'JSON kopieren',
}
