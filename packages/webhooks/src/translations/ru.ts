import { keys, type TranslationKey } from './keys'

export const ru: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Подписка',
	[keys.subscriptionPlural]: 'Подписки',
	[keys.deliverySingular]: 'Доставка',
	[keys.deliveryPlural]: 'Доставки',
	[keys.fieldName]: 'Название',
	[keys.fieldUrl]: 'URL эндпоинта',
	[keys.fieldEnabled]: 'Включено',
	[keys.fieldEvents]: 'События',
	[keys.fieldSecret]: 'Секрет для подписи',
	[keys.fieldSecretHelp]:
		'Показывается полностью один раз при создании, дальше скрыт. Им подписываются доставки, скопируйте его получателю сейчас.',
	[keys.fieldHeaders]: 'Свои заголовки',
	[keys.fieldDescription]: 'Описание',
	[keys.statusPending]: 'В очереди',
	[keys.statusSuccess]: 'Доставлено',
	[keys.statusFailed]: 'Ошибка',
	[keys.statusDead]: 'Отброшено',
	[keys.redeliver]: 'Доставить повторно',
	[keys.redeliverDone]: 'Повторная доставка поставлена в очередь',
}
