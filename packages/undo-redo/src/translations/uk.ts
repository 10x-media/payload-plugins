import { keys, type TranslationKey } from './keys'

export const uk: Record<TranslationKey, string> = {
	[keys.undo]: 'Скасувати',
	[keys.redo]: 'Повторити',
	[keys.debug]: 'Історія скасувань',
	[keys.debugTooltip]: 'Переглянути історію скасувань',
	[keys.debugTitle]: 'Історія скасувань',
	[keys.debugEmpty]: 'Історія поки порожня.',
	[keys.debugClose]: 'Закрити',
	[keys.debugPending]: 'Очікує (не записано)',
	[keys.debugOriginal]: 'Початковий стан',
	[keys.debugCopy]: 'Копіювати JSON',
}
