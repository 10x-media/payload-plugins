import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Settings Overlay',
	[keys.appearanceLabel]: 'Appearance',
	[keys.back]: 'Back',
	[keys.close]: 'Close',
	[keys.delete]: 'Delete',
	[keys.deleteBody]: 'This document will be permanently deleted. This cannot be undone.',
	[keys.deleteConfirm]: 'Delete',
	[keys.deleteHeading]: 'Delete document?',
	[keys.deleted]: 'Document deleted',
	[keys.discardBody]: 'You have unsaved changes. Leaving now discards them.',
	[keys.discardConfirm]: 'Discard changes',
	[keys.discardHeading]: 'Discard changes?',
	[keys.empty]: 'Nothing to show here yet.',
	[keys.loadFailed]: 'Could not load this. Please try again.',
	[keys.noResults]: 'No matches.',
	[keys.searchPlaceholder]: 'Search',
}
