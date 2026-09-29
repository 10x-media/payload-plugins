import { keys, type TranslationKey } from './keys'

/** Russian values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Блокировка контента',
	[keys.collectionSingular]: 'Блокировка контента',
	[keys.collectionPlural]: 'Блокировки контента',

	[keys.fieldTitle]: 'Название',
	[keys.fieldAnnounceAt]: 'Объявить с',
	[keys.fieldAnnounceAtDescription]:
		'Когда начинает показываться баннер. Оставьте пустым, чтобы не объявлять.',
	[keys.fieldStartsAt]: 'Начало',
	[keys.fieldStartsAtDescription]: 'Оставьте пустым, чтобы заблокировать контент сразу.',
	[keys.fieldEndAtTime]: 'Завершить в заданное время',
	[keys.fieldEndsAt]: 'Окончание',
	[keys.fieldEndedAt]: 'Завершено',
	[keys.fieldLockEverything]: 'Заблокировать всё',
	[keys.fieldLockEverythingDescription]: 'Отключите, чтобы заблокировать только выбранный контент.',
	[keys.fieldGroups]: 'Группы',
	[keys.fieldCollections]: 'Коллекции',
	[keys.fieldGlobals]: 'Глобальные настройки',
	[keys.fieldMessage]: 'Сообщение',
	[keys.fieldMessageDescription]: 'Необязательный текст в баннере под стандартным уведомлением.',
	[keys.fieldStatus]: 'Статус',
	[keys.statusPending]: 'Ожидает',
	[keys.statusAnnounced]: 'Объявлено',
	[keys.statusActive]: 'Активно',
	[keys.statusEnded]: 'Завершено',

	[keys.dateBlockLabel]: 'Дата',
	[keys.dateBlockDate]: 'Дата и время',
	[keys.dateBlockFormat]: 'Формат',
	[keys.formatDatetime]: 'Дата и время',
	[keys.formatDate]: 'Дата',
	[keys.formatTime]: 'Время',
	[keys.formatRelative]: 'Относительно',

	[keys.errorAnnounceAfterStart]: 'Объявление должно начинаться раньше блокировки.',
	[keys.errorEndBeforeStart]: 'Блокировка должна заканчиваться после начала.',
	[keys.errorEndsAtRequired]: 'Укажите, когда заканчивается блокировка.',
	[keys.errorTargetsRequired]: 'Выберите хотя бы один элемент для блокировки.',
	[keys.errorEndedReadOnly]: 'Завершённую блокировку больше нельзя изменить.',
	[keys.errorActiveStartMoved]:
		'Активную блокировку нельзя перенести в будущее. Завершите её и запланируйте новую.',
	[keys.errorLocked]: 'Контент заблокирован на время технических работ. Повторите попытку позже.',

	[keys.bannerAnnouncedTitle]: 'Запланированные технические работы',
	[keys.bannerActiveTitle]: 'Идут технические работы',
	[keys.bannerAnnouncedEverything]: 'Контент будет доступен только для чтения.',
	[keys.bannerActiveEverything]: 'Контент доступен только для чтения.',
	[keys.bannerAnnouncedPartial]: 'Будет доступно только для чтения: {{what}}.',
	[keys.bannerActivePartial]: 'Только для чтения: {{what}}.',
	[keys.bannerFrom]: 'С',
	[keys.bannerUntil]: 'До',
	[keys.bannerEndsIn]: 'Закончится через {{time}}',
	[keys.bannerDismiss]: 'Скрыть',

	[keys.actionLockNow]: 'Заблокировать сейчас',
	[keys.actionLockNowTitle]: 'Внеплановая блокировка',
	[keys.actionEndNow]: 'Завершить сейчас',
	[keys.actionFailed]: 'Не удалось обновить блокировку.',
	[keys.confirmLockNowHeading]: 'Заблокировать весь контент сейчас?',
	[keys.confirmLockNowBody]:
		'Все сразу теряют доступ на запись, пока кто-нибудь не завершит эту блокировку.',
	[keys.confirmEndNowHeading]: 'Завершить эту блокировку сейчас?',
	[keys.confirmEndNowBody]:
		'Контент под этой блокировкой сразу снова станет доступен для редактирования.',
}
