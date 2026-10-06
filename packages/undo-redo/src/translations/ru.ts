import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.undo]: 'Отменить',
	[keys.redo]: 'Повторить',
	[keys.debug]: 'История отмен',
	[keys.debugTooltip]: 'Посмотреть историю отмен',
	[keys.debugTitle]: 'История отмен',
	[keys.debugEmpty]: 'История пока пуста.',
	[keys.debugClose]: 'Закрыть',
	[keys.debugPending]: 'Ожидает (не записано)',
	[keys.debugOriginal]: 'Исходное состояние',
	[keys.debugCopy]: 'Копировать JSON',
}
