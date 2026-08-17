/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	gridView: 'folderPicker:gridView',
	listView: 'folderPicker:listView',
	orderLabel: 'folderPicker:orderLabel',
	pickManyHint: 'folderPicker:pickManyHint',
	pluginName: 'folderPicker:pluginName',
	retry: 'folderPicker:retry',
	sortByLabel: 'folderPicker:sortByLabel',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
