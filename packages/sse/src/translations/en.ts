import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'SSE',
	[keys.alsoViewing]: 'also viewing',
	[keys.editing]: 'editing',
	[keys.isEditing]: '{{name}} is editing',
	[keys.areEditing]: '{{name}} and {{other}} are editing',
	[keys.areEditingMany]: '{{name}} and {{count}} others are editing',
	[keys.conflictUpdated]:
		'Someone else saved this document. Reload to see their version, or keep editing (your save will overwrite).',
	[keys.conflictDeleted]: 'This document was deleted. Reload, or keep editing (save may fail).',
	[keys.conflictReload]: 'Reload',
	[keys.conflictKeepEditing]: 'Keep editing',
}
