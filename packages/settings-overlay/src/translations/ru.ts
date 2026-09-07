import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Панель настроек',
	[keys.appearanceLabel]: 'Оформление',
	[keys.back]: 'Назад',
	[keys.close]: 'Закрыть',
	[keys.discardBody]: 'Есть несохранённые изменения. Если уйти сейчас, они пропадут.',
	[keys.discardConfirm]: 'Отменить изменения',
	[keys.discardHeading]: 'Отменить изменения?',
	[keys.empty]: 'Здесь пока ничего нет.',
	[keys.loadFailed]: 'Не удалось загрузить. Попробуйте ещё раз.',
	[keys.noResults]: 'Ничего не найдено.',
	[keys.searchPlaceholder]: 'Поиск',
	[keys.widgetNotice]: 'Этот виджет невозможно показать. Вы можете убрать его с панели управления.',
}
