/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`, `de.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'fields:pluginName',
	presets: 'fields:presets',
	searchIcons: 'fields:searchIcons',
	noIconsFound: 'fields:noIconsFound',
	browseAll: 'fields:browseAll',
	recent: 'fields:recent',
	allIcons: 'fields:allIcons',
	libraryUnavailable: 'fields:libraryUnavailable',
	missingPreset: 'fields:missingPreset',
	reveal: 'fields:reveal',
	conceal: 'fields:conceal',
	encryptedValue: 'fields:encryptedValue',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
