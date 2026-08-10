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
      [keys.mustBeLoggedIn]: 'Ви повинні увійти в систему для перегляду журналу аудиту.',
      [keys.noPermission]: 'У вас немає дозволу для перегляду журналу аудиту.',
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
      [keys.sectionSnapshot]: 'Знімок',
      [keys.sectionAuthEvent]: 'Подія автентифікації',
      [keys.sectionCustomEvent]: 'Кастомна подія',
      [keys.viewGlobal]: 'Переглянути глобальний →',
      [keys.viewDocument]: 'Переглянути документ →',
      [keys.fieldsChanged]: '{{count}} поле',
      [keys.fieldsChangedPlural]: '{{count}} полів',

      // Diff viewer
      [keys.diffPath]: 'Шлях',
      [keys.diffBefore]: 'До',
      [keys.diffAfter]: 'Після',

      // Auth events
      [keys.authEventLogin]: 'Вхід',
      [keys.authEventForgotPassword]: 'Забув пароль',
}
