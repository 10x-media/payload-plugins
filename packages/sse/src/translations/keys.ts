/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'sse:pluginName',
	alsoViewing: 'sse:alsoViewing',
	editing: 'sse:editing',
	isEditing: 'sse:isEditing',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
