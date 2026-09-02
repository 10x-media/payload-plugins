import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Журнал аудита',
	// View header
	[keys.title]: 'Журнал аудита',
	[keys.entries]: '{{count}} записей',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'Журнал аудита',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'Выберите тенант, чтобы просмотреть журнал аудита.',

	// Empty state
	[keys.noEntries]: 'Записи аудита не найдены.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} из {{total}}',

	// Debug bar
	[keys.debug]: 'Отладка',
	[keys.queuing]: 'Постановка в очередь…',
	[keys.runArchive]: 'Запустить архивацию',
	[keys.runDelete]: 'Запустить удаление',

	// Filter bar
	[keys.filterCollection]: 'Коллекция',
	[keys.filterGlobal]: 'Глобальный',
	[keys.filterOperation]: 'Операция',
	[keys.filterTenant]: 'Тенант',
	[keys.filterUser]: 'Пользователь',
	[keys.filterDocument]: 'Документ',
	[keys.filterEventType]: 'Тип события',
	[keys.filterChangedPath]: 'Изменённый путь',
	[keys.filterGroup]: 'Группа',
	[keys.groupFilterBtn]: 'Фильтровать по группе',
	[keys.filterDate]: 'Дата',
	[keys.filterDateRange]: 'Диапазон дат',
	[keys.addFilter]: '+ Добавить фильтр',
	[keys.apply]: 'Применить',
	[keys.clearAll]: 'Очистить всё',

	// Editors shared
	[keys.selectPlaceholder]: '— Выберите —',
	[keys.done]: 'Готово',

	// Date range editor
	[keys.dateFrom]: 'От',
	[keys.dateTo]: 'До',
	[keys.startDate]: 'Начальная дата…',
	[keys.endDate]: 'Конечная дата…',

	// Single value editor
	[keys.groupPlaceholder]: 'ID группы…',
	[keys.orEnterId]: 'или введите ID вручную',
	[keys.selectCollectionHint]: 'Выберите фильтр коллекции для поиска',
	[keys.documentIdPlaceholder]: 'ID документа…',
	[keys.update]: 'Обновить',
	[keys.add]: 'Добавить',
	[keys.selectEventPlaceholder]: '— Выберите событие —',
	[keys.eventTypePlaceholder]: 'Тип события…',
	[keys.fieldPathPlaceholder]: 'Путь поля…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Выберите коллекцию…',
	[keys.userIdPlaceholder]: 'ID пользователя…',

	// Doc select
	[keys.searchPlaceholder]: 'Поиск…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Язык',
	[keys.sectionSnapshot]: 'Снимок',
	[keys.sectionAuthEvent]: 'Событие аутентификации',
	[keys.sectionCustomEvent]: 'Пользовательское событие',
	[keys.viewGlobal]: 'Просмотреть глобальный →',
	[keys.viewDocument]: 'Просмотреть документ →',
	[keys.fieldsChanged]: '{{count}} поле',
	[keys.fieldsChangedPlural]: '{{count}} полей',

	// Diff viewer
	[keys.diffPath]: 'Путь',
	[keys.diffBefore]: 'До',
	[keys.diffAfter]: 'После',

	// Auth events
	[keys.authEventLogin]: 'Вход',
	[keys.authEventForgotPassword]: 'Забыли пароль',
	[keys.authEventFailedLogin]: 'Неудачный вход',
}
