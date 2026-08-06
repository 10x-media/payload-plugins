/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`, `de.ts`), or it is a type error.
 */
export const keys = {
	undo: 'undoRedo:undo',
	undoTooltip: 'undoRedo:undoTooltip',
	redo: 'undoRedo:redo',
	redoTooltip: 'undoRedo:redoTooltip',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
