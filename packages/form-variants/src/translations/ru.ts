import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.back]: 'Назад',
	[keys.done]: 'Готово',
	[keys.next]: 'Далее',
	[keys.noVariants]: 'Для вашей учётной записи нет доступной формы в этой коллекции.',
	[keys.pluginName]: 'Варианты формы',
	[keys.progress]: 'Шаги',
	[keys.readOnly]: 'Этот документ доступен только для чтения.',
	[keys.stepCompleted]: 'завершён',
	[keys.stepInvalid]: 'Исправьте выделенные поля, чтобы продолжить.',
	[keys.switcherLabel]: 'Форма',
}
