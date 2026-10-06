import { keys, type TranslationKey } from './keys'

export const uk: Record<TranslationKey, string> = {
	[keys.back]: 'Назад',
	[keys.done]: 'Готово',
	[keys.next]: 'Далі',
	[keys.noVariants]: 'Для вашого облікового запису немає доступної форми в цій колекції.',
	[keys.pluginName]: 'Варіанти форми',
	[keys.progress]: 'Кроки',
	[keys.readOnly]: 'Цей документ доступний лише для читання.',
	[keys.stepCompleted]: 'завершено',
	[keys.stepInvalid]: 'Виправте позначені поля, щоб продовжити.',
	[keys.switcherLabel]: 'Форма',
}
