import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.back]: 'Back',
	[keys.done]: 'Done',
	[keys.next]: 'Next',
	[keys.noVariants]: 'There is no form available for your account on this collection.',
	[keys.pluginName]: 'Form Variants',
	[keys.progress]: 'Steps',
	[keys.readOnly]: 'This document is read-only.',
	[keys.stepCompleted]: 'completed',
	[keys.stepInvalid]: 'Fix the highlighted fields to continue.',
	[keys.switcherLabel]: 'Form',
}
