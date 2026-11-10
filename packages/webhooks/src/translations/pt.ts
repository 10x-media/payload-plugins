import { keys, type TranslationKey } from './keys'

export const pt: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Subscrição',
	[keys.subscriptionPlural]: 'Subscrições',
	[keys.deliverySingular]: 'Entrega',
	[keys.deliveryPlural]: 'Entregas',
	[keys.fieldName]: 'Nome',
	[keys.fieldUrl]: 'URL do endpoint',
	[keys.urlInvalid]: 'Introduza um URL absoluto com http:// ou https://.',
	[keys.urlHostNotAllowed]: 'Este host não está na lista de hosts permitidos para webhooks.',
	[keys.urlNotHttps]:
		'Introduza um URL https://. Não é permitido http:// sem encriptação para endpoints de webhook.',
	[keys.urlPrivateAddress]:
		'Este endereço é privado, local ou não é acessível publicamente, pelo que não é possível enviar webhooks para ele.',
	[keys.fieldEnabled]: 'Ativado',
	[keys.fieldEvents]: 'Eventos',
	[keys.fieldSecret]: 'Segredo de assinatura',
	[keys.fieldSecretHelp]:
		'Assina as entregas. É guardado cifrado e nunca mais é mostrado depois de guardado, por isso copie-o agora para o recetor. Se o perder, rode-o em vez de o procurar.',
	[keys.fieldPreviousSecretExpires]: 'Segredo anterior válido até',
	[keys.fieldPreviousSecretExpiresHelp]:
		'Enquanto estiver definido, as entregas levam uma assinatura do segredo atual e outra do anterior. Depois desse momento só o atual assina.',
	[keys.rotateSecret]: 'Rodar segredo',
	[keys.rotateSecretTitle]: 'Rodar o segredo de assinatura',
	[keys.rotateSecretAcknowledge]: 'Já o guardei',
	[keys.rotateSecretCopy]: 'Copiar',
	[keys.rotateSecretCopied]: 'Copiado',
	[keys.rotateSecretCopyFailed]:
		'Não foi possível copiar automaticamente. Selecione o segredo e copie-o.',
	[keys.rotateSecretRevealTitle]: 'Novo segredo de assinatura',
	[keys.rotateSecretRevealBody]:
		'Esta é a única vez que este segredo é mostrado. Copie-o para o seu recetor antes de fechar este diálogo.',
	[keys.rotateSecretDone]: 'Segredo rodado',
	[keys.rotateSecretFailed]: 'Não foi possível rodar o segredo',
	[keys.rotateSecretConfirm]:
		'Rodar este segredo de assinatura? O atual continua a funcionar durante o período de tolerância e depois deixa de funcionar. Verá o novo segredo uma única vez.',
	[keys.rotateSecretForbidden]: 'Não tem permissão para rodar este segredo',
	[keys.rotateSecretConflict]:
		'Esta subscrição foi alterada durante a rotação. Recarregue e tente de novo se ainda precisar de um novo segredo',
	[keys.rotateSecretRejected]: 'A rotação foi rejeitada. Verifique o segredo que indicou',
	[keys.fieldHeaders]: 'Cabeçalhos personalizados',
	[keys.headerReserved]:
		"'{{name}}' é definido pelo plugin ou pelo transporte HTTP em cada entrega e não pode ser substituído.",
	[keys.headerInvalid]:
		"'{{name}}' não é um nome de cabeçalho HTTP válido. Use letras, dígitos e qualquer um de !#$%&'*+-.^_`|~, sem espaços.",
	[keys.headerValueInvalid]: 'O valor de um cabeçalho não pode conter quebras de linha.',
	[keys.fieldDescription]: 'Descrição',
	[keys.statusPending]: 'Pendente',
	[keys.statusSuccess]: 'Entregue',
	[keys.statusFailed]: 'Com falha',
	[keys.statusDead]: 'Descartada',
	[keys.redeliver]: 'Reenviar',
	[keys.redeliverDone]: 'Reenvio na fila',
	[keys.redeliverSent]: 'Reenviada',
	[keys.redeliverFailed]: 'Não foi possível reenviar',
	[keys.redeliverConfirm]:
		'Enviar esta carga outra vez? Sai como uma nova entrega com um novo webhook-id, por isso um recetor que deduplique pelo id vai processá-la uma segunda vez.',
}
