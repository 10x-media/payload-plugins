import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Subscrição',
	[keys.subscriptionPlural]: 'Subscrições',
	[keys.deliverySingular]: 'Entrega',
	[keys.deliveryPlural]: 'Entregas',
	[keys.fieldName]: 'Nome',
	[keys.fieldUrl]: 'URL do endpoint',
	[keys.fieldEnabled]: 'Ativado',
	[keys.fieldEvents]: 'Eventos',
	[keys.fieldSecret]: 'Segredo de assinatura',
	[keys.fieldSecretHelp]:
		'Mostrado por completo apenas uma vez na criação, depois fica mascarado. Assina as entregas, copie-o agora para o recetor.',
	[keys.fieldHeaders]: 'Cabeçalhos personalizados',
	[keys.fieldDescription]: 'Descrição',
	[keys.statusPending]: 'Pendente',
	[keys.statusSuccess]: 'Entregue',
	[keys.statusFailed]: 'Com falha',
	[keys.statusDead]: 'Descartada',
	[keys.redeliver]: 'Reenviar',
	[keys.redeliverDone]: 'Reenvio na fila',
}
