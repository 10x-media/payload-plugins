import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Панель настроек',
	[keys.appearanceLabel]: 'Оформление',
	[keys.back]: 'Назад',
	[keys.close]: 'Закрыть',
	[keys.delete]: 'Удалить',
	[keys.deleteBody]: 'Документ будет удалён безвозвратно. Отменить это нельзя.',
	[keys.deleteConfirm]: 'Удалить',
	[keys.deleteHeading]: 'Удалить документ?',
	[keys.deleted]: 'Документ удалён',
	[keys.discardBody]: 'Есть несохранённые изменения. Если уйти сейчас, они пропадут.',
	[keys.discardConfirm]: 'Отменить изменения',
	[keys.discardHeading]: 'Отменить изменения?',
	[keys.empty]: 'Здесь пока ничего нет.',
	[keys.loadFailed]: 'Не удалось загрузить. Попробуйте ещё раз.',
	[keys.noResults]: 'Ничего не найдено.',
	[keys.searchPlaceholder]: 'Поиск',
}
