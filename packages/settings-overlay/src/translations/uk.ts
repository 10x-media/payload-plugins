import { keys, type TranslationKey } from './keys'

export const uk: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Панель налаштувань',
	[keys.appearanceLabel]: 'Вигляд',
	[keys.back]: 'Назад',
	[keys.close]: 'Закрити',
	[keys.delete]: 'Видалити',
	[keys.deleteBody]: 'Документ буде видалено назавжди. Скасувати це не вийде.',
	[keys.deleteConfirm]: 'Видалити',
	[keys.deleteHeading]: 'Видалити документ?',
	[keys.deleted]: 'Документ видалено',
	[keys.discardBody]: 'Є незбережені зміни. Якщо піти зараз, вони зникнуть.',
	[keys.discardConfirm]: 'Відхилити зміни',
	[keys.discardHeading]: 'Відхилити зміни?',
	[keys.empty]: 'Тут поки що порожньо.',
	[keys.loadFailed]: 'Не вдалося завантажити. Спробуйте ще раз.',
	[keys.noResults]: 'Нічого не знайдено.',
	[keys.searchPlaceholder]: 'Пошук',
}
