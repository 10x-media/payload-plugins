import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.undo]: 'Undo',
	[keys.undoTooltip]: 'Undo change (Ctrl+Z)',
	[keys.redo]: 'Redo',
	[keys.redoTooltip]: 'Redo change (Ctrl+Shift+Z)',
	[keys.debug]: 'Undo history',
	[keys.debugTooltip]: 'Inspect undo history',
	[keys.debugTitle]: 'Undo history',
	[keys.debugEmpty]: 'No history captured yet.',
	[keys.debugClose]: 'Close',
	[keys.debugPending]: 'Pending (not captured)',
	[keys.debugOriginal]: 'Original state',
	[keys.debugCopy]: 'Copy JSON',
}
