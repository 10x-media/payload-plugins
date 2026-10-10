import { keys, type TranslationKey } from './keys'

export const uk: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Підписка',
	[keys.subscriptionPlural]: 'Підписки',
	[keys.deliverySingular]: 'Доставка',
	[keys.deliveryPlural]: 'Доставки',
	[keys.fieldName]: 'Назва',
	[keys.fieldUrl]: 'URL ендпоінта',
	[keys.urlInvalid]: 'Вкажіть абсолютний URL з http:// або https://.',
	[keys.urlHostNotAllowed]: 'Цей хост не входить до списку дозволених хостів для вебхуків.',
	[keys.urlNotHttps]:
		'Введіть URL з https://. Незашифрований http:// не дозволено для кінцевих точок вебхуків.',
	[keys.urlPrivateAddress]:
		'Ця адреса приватна, локальна або недоступна з інтернету, тому надсилати на неї вебхуки не можна.',
	[keys.fieldEnabled]: 'Увімкнено',
	[keys.fieldEvents]: 'Події',
	[keys.fieldSecret]: 'Секрет для підпису',
	[keys.fieldSecretHelp]:
		'Ним підписуються доставки. Зберігається зашифрованим і після збереження більше не показується, тож скопіюйте його отримувачу зараз. Якщо загубите, замініть його, а не шукайте.',
	[keys.fieldPreviousSecretExpires]: 'Попередній секрет дійсний до',
	[keys.fieldPreviousSecretExpiresHelp]:
		'Поки значення задано, доставки підписуються і поточним, і попереднім секретом. Після цього моменту підписує лише поточний.',
	[keys.rotateSecret]: 'Замінити секрет',
	[keys.rotateSecretTitle]: 'Заміна секрету для підпису',
	[keys.rotateSecretAcknowledge]: 'Секрет збережено',
	[keys.rotateSecretCopy]: 'Копіювати',
	[keys.rotateSecretCopied]: 'Скопійовано',
	[keys.rotateSecretCopyFailed]:
		'Не вдалося скопіювати автоматично. Виділіть секрет і скопіюйте його.',
	[keys.rotateSecretRevealTitle]: 'Новий секрет для підпису',
	[keys.rotateSecretRevealBody]:
		'Цей секрет показується лише один раз. Скопіюйте його отримувачу, перш ніж закрити це вікно.',
	[keys.rotateSecretDone]: 'Секрет замінено',
	[keys.rotateSecretFailed]: 'Не вдалося замінити секрет',
	[keys.rotateSecretConfirm]:
		'Замінити цей секрет для підпису? Поточний працюватиме протягом пільгового періоду, а потім перестане. Новий секрет ви побачите один раз.',
	[keys.rotateSecretForbidden]: 'У вас немає прав на заміну цього секрету',
	[keys.rotateSecretConflict]:
		'Підписка змінилася під час заміни. Оновіть сторінку і спробуйте ще раз, якщо новий секрет досі потрібен',
	[keys.rotateSecretRejected]: 'Заміну відхилено. Перевірте вказаний секрет',
	[keys.fieldHeaders]: 'Власні заголовки',
	[keys.headerReserved]:
		"Заголовок '{{name}}' плагін або HTTP-транспорт задає під час кожної доставки, перевизначити його не можна.",
	[keys.headerInvalid]:
		"'{{name}}' не є допустимим іменем HTTP-заголовка. Використовуйте літери, цифри та символи !#$%&'*+-.^_`|~ без пробілів.",
	[keys.headerValueInvalid]: 'Значення заголовка не може містити переноси рядків.',
	[keys.fieldDescription]: 'Опис',
	[keys.statusPending]: 'У черзі',
	[keys.statusSuccess]: 'Доставлено',
	[keys.statusFailed]: 'Помилка',
	[keys.statusDead]: 'Відкинуто',
	[keys.redeliver]: 'Доставити повторно',
	[keys.redeliverDone]: 'Повторну доставку поставлено в чергу',
	[keys.redeliverSent]: 'Доставлено повторно',
	[keys.redeliverFailed]: 'Не вдалося доставити повторно',
	[keys.redeliverConfirm]:
		'Надіслати ці дані ще раз? Вони підуть новою доставкою з новим webhook-id, тож отримувач, який відсіює дублікати за id, обробить їх повторно.',
}
