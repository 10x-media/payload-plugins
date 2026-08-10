/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`, `de.ts`), or it is a type error.
 */
export const keys = {
	undo: 'undoRedo:undo',
	redo: 'undoRedo:redo',
	debug: 'undoRedo:debug',
	debugTooltip: 'undoRedo:debugTooltip',
	debugTitle: 'undoRedo:debugTitle',
	debugEmpty: 'undoRedo:debugEmpty',
	debugClose: 'undoRedo:debugClose',
	debugPending: 'undoRedo:debugPending',
	debugOriginal: 'undoRedo:debugOriginal',
	debugCopy: 'undoRedo:debugCopy',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
