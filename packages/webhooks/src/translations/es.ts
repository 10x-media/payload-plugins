import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Suscripción',
	[keys.subscriptionPlural]: 'Suscripciones',
	[keys.deliverySingular]: 'Entrega',
	[keys.deliveryPlural]: 'Entregas',
	[keys.fieldName]: 'Nombre',
	[keys.fieldUrl]: 'URL del endpoint',
	[keys.fieldEnabled]: 'Activado',
	[keys.fieldEvents]: 'Eventos',
	[keys.fieldSecret]: 'Secreto de firma',
	[keys.fieldSecretHelp]:
		'Se muestra completo una sola vez al crearlo, después queda enmascarado. Firma las entregas, cópielo ahora en el receptor.',
	[keys.fieldHeaders]: 'Cabeceras personalizadas',
	[keys.fieldDescription]: 'Descripción',
	[keys.statusPending]: 'Pendiente',
	[keys.statusSuccess]: 'Entregada',
	[keys.statusFailed]: 'Fallida',
	[keys.statusDead]: 'Descartada',
	[keys.redeliver]: 'Reenviar',
	[keys.redeliverDone]: 'Reenvío en cola',
}
