/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	back: 'formVariants:back',
	done: 'formVariants:done',
	next: 'formVariants:next',
	noVariants: 'formVariants:noVariants',
	pluginName: 'formVariants:pluginName',
	progress: 'formVariants:progress',
	publish: 'formVariants:publish',
	readOnly: 'formVariants:readOnly',
	save: 'formVariants:save',
	saveDraft: 'formVariants:saveDraft',
	stepCompleted: 'formVariants:stepCompleted',
	stepInvalid: 'formVariants:stepInvalid',
	switchConfirm: 'formVariants:switchConfirm',
	switcherLabel: 'formVariants:switcherLabel',
	unsavedSwitchBody: 'formVariants:unsavedSwitchBody',
	unsavedSwitchHeading: 'formVariants:unsavedSwitchHeading',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
