import { keys, type TranslationKey } from './keys'

export const uk: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Підписка',
	[keys.subscriptionPlural]: 'Підписки',
	[keys.deliverySingular]: 'Доставка',
	[keys.deliveryPlural]: 'Доставки',
	[keys.fieldName]: 'Назва',
	[keys.fieldUrl]: 'URL ендпоінта',
	[keys.fieldEnabled]: 'Увімкнено',
	[keys.fieldEvents]: 'Події',
	[keys.fieldSecret]: 'Секрет для підпису',
	[keys.fieldSecretHelp]:
		'Показується повністю один раз під час створення, далі прихований. Ним підписуються доставки, скопіюйте його отримувачу зараз.',
	[keys.fieldHeaders]: 'Власні заголовки',
	[keys.fieldDescription]: 'Опис',
	[keys.statusPending]: 'У черзі',
	[keys.statusSuccess]: 'Доставлено',
	[keys.statusFailed]: 'Помилка',
	[keys.statusDead]: 'Відкинуто',
	[keys.redeliver]: 'Доставити повторно',
	[keys.redeliverDone]: 'Повторну доставку поставлено в чергу',
}
