import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Подписка',
	[keys.subscriptionPlural]: 'Подписки',
	[keys.deliverySingular]: 'Доставка',
	[keys.deliveryPlural]: 'Доставки',
	[keys.fieldName]: 'Название',
	[keys.fieldUrl]: 'URL эндпоинта',
	[keys.urlInvalid]: 'Укажите абсолютный URL с http:// или https://.',
	[keys.fieldEnabled]: 'Включено',
	[keys.fieldEvents]: 'События',
	[keys.fieldSecret]: 'Секрет для подписи',
	[keys.fieldSecretHelp]:
		'Им подписываются доставки. Хранится в зашифрованном виде и после сохранения больше не показывается, поэтому скопируйте его получателю сейчас. Если потеряете, замените его, а не ищите.',
	[keys.fieldPreviousSecretExpires]: 'Предыдущий секрет действует до',
	[keys.fieldPreviousSecretExpiresHelp]:
		'Пока значение задано, доставки подписываются и текущим, и предыдущим секретом. После этого момента подписывает только текущий.',
	[keys.rotateSecret]: 'Заменить секрет',
	[keys.rotateSecretTitle]: 'Замена секрета для подписи',
	[keys.rotateSecretAcknowledge]: 'Секрет сохранён',
	[keys.rotateSecretCopy]: 'Копировать',
	[keys.rotateSecretCopied]: 'Скопировано',
	[keys.rotateSecretCopyFailed]:
		'Не удалось скопировать автоматически. Выделите секрет и скопируйте его.',
	[keys.rotateSecretRevealTitle]: 'Новый секрет для подписи',
	[keys.rotateSecretRevealBody]:
		'Этот секрет показывается только один раз. Скопируйте его получателю, прежде чем закрыть это окно.',
	[keys.rotateSecretDone]: 'Секрет заменён',
	[keys.rotateSecretFailed]: 'Не удалось заменить секрет',
	[keys.rotateSecretConfirm]:
		'Заменить этот секрет для подписи? Текущий продолжит работать в течение льготного периода, затем перестанет. Новый секрет вы увидите один раз.',
	[keys.rotateSecretForbidden]: 'У вас нет прав на замену этого секрета',
	[keys.rotateSecretConflict]:
		'Подписка изменилась во время замены. Обновите страницу и повторите попытку, если новый секрет всё ещё нужен',
	[keys.rotateSecretRejected]: 'Замена отклонена. Проверьте указанный секрет',
	[keys.fieldHeaders]: 'Свои заголовки',
	[keys.headerReserved]:
		"Заголовок '{{name}}' плагин задаёт при каждой доставке, переопределить его нельзя.",
	[keys.headerInvalid]:
		"'{{name}}' не является допустимым именем HTTP-заголовка. Используйте буквы, цифры и символы !#$%&'*+-.^_`|~ без пробелов.",
	[keys.headerValueInvalid]: 'Значение заголовка не может содержать переносы строк.',
	[keys.fieldDescription]: 'Описание',
	[keys.statusPending]: 'В очереди',
	[keys.statusSuccess]: 'Доставлено',
	[keys.statusFailed]: 'Ошибка',
	[keys.statusDead]: 'Отброшено',
	[keys.redeliver]: 'Доставить повторно',
	[keys.redeliverDone]: 'Повторная доставка поставлена в очередь',
	[keys.redeliverFailed]: 'Не удалось доставить повторно',
	[keys.redeliverConfirm]:
		'Отправить эти данные ещё раз? Они уйдут новой доставкой с новым webhook-id, поэтому получатель, который отсекает дубликаты по id, обработает их повторно.',
}
