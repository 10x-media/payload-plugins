import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const uk: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Журнал аудиту',
	// View header
	[keys.title]: 'Журнал аудиту',
	[keys.entries]: '{{count}} записів',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'Журнал аудиту',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'Оберіть тенант для перегляду журналу аудиту.',

	// Empty state
	[keys.noEntries]: 'Записів аудиту не знайдено.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} з {{total}}',

	// Debug bar
	[keys.debug]: 'Налагодження',
	[keys.queuing]: 'Ставлення в чергу…',
	[keys.runArchive]: 'Запустити архівацію',
	[keys.runDelete]: 'Запустити видалення',

	// Filter bar
	[keys.filterCollection]: 'Колекція',
	[keys.filterGlobal]: 'Глобальний',
	[keys.filterOperation]: 'Операція',
	[keys.filterTenant]: 'Тенант',
	[keys.filterUser]: 'Користувач',
	[keys.filterDocument]: 'Документ',
	[keys.filterEventType]: 'Тип події',
	[keys.filterChangedPath]: 'Змінений шлях',
	[keys.filterGroup]: 'Група',
	[keys.groupFilterBtn]: 'Фільтрувати за групою',
	[keys.filterDate]: 'Дата',
	[keys.filterDateRange]: 'Діапазон дат',
	[keys.addFilter]: '+ Додати фільтр',
	[keys.apply]: 'Застосувати',
	[keys.clearAll]: 'Очистити все',

	// Editors shared
	[keys.selectPlaceholder]: '— Оберіть —',
	[keys.done]: 'Готово',

	// Date range editor
	[keys.dateFrom]: 'Від',
	[keys.dateTo]: 'До',
	[keys.startDate]: 'Початкова дата…',
	[keys.endDate]: 'Кінцева дата…',

	// Single value editor
	[keys.groupPlaceholder]: 'ID групи…',
	[keys.orEnterId]: 'або введіть ID вручну',
	[keys.selectCollectionHint]: 'Оберіть фільтр колекції для пошуку',
	[keys.documentIdPlaceholder]: 'ID документа…',
	[keys.update]: 'Оновити',
	[keys.add]: 'Додати',
	[keys.selectEventPlaceholder]: '— Оберіть подію —',
	[keys.eventTypePlaceholder]: 'Тип події…',
	[keys.fieldPathPlaceholder]: 'Шлях поля…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Оберіть колекцію…',
	[keys.userIdPlaceholder]: 'ID користувача…',

	// Doc select
	[keys.searchPlaceholder]: 'Пошук…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Локалізація',
	[keys.filterEvent]: 'Подія',
	[keys.filterAll]: 'Усі',
	[keys.dateAnyTime]: 'Будь-коли',
	[keys.dateLast24h]: 'Останні 24 години',
	[keys.dateLast7d]: 'Останні 7 днів',
	[keys.dateLast30d]: 'Останні 30 днів',
	[keys.dateCustomRange]: 'Свій період…',
	[keys.eventGroupWrites]: 'Зміни',
	[keys.eventGroupAuth]: 'Автентифікація',
	[keys.eventGroupCustom]: 'Кастомні',
	[keys.eventAllAuth]: 'Усі події автентифікації',
	[keys.eventAllCustom]: 'Усі кастомні події',
	[keys.eventOther]: 'Інший тип події…',
	[keys.moreFilters]: 'Більше фільтрів',
	[keys.choose]: 'Вибрати…',
	[keys.refPlaceholder]: 'Виберіть або введіть ID',
	[keys.impersonated]: 'імперсонація',
	[keys.impersonatedBy]: 'Від імені користувача діяв',
	[keys.deletedUser]: 'Видалений користувач',
	[keys.toggleDetails]: 'Показати або сховати деталі',
	[keys.sectionSnapshot]: 'Знімок',
	[keys.sectionAuthEvent]: 'Подія автентифікації',
	[keys.sectionCustomEvent]: 'Кастомна подія',
	[keys.viewGlobal]: 'Глобальний',
	[keys.viewDocument]: 'Документ',
	[keys.fieldsChanged]: '{{count}} поле',
	[keys.fieldsChangedPlural]: '{{count}} полів',

	// Diff viewer
	[keys.diffPath]: 'Шлях',
	[keys.diffBefore]: 'До',
	[keys.diffAfter]: 'Після',

	// Auth events
	[keys.authEventLogin]: 'Вхід',
	[keys.authEventForgotPassword]: 'Забув пароль',
	[keys.authEventFailedLogin]: 'Невдалий вхід',
}
