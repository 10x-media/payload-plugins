import { keys, type TranslationKey } from './keys'

export const es: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Suscripción',
	[keys.subscriptionPlural]: 'Suscripciones',
	[keys.deliverySingular]: 'Entrega',
	[keys.deliveryPlural]: 'Entregas',
	[keys.fieldName]: 'Nombre',
	[keys.fieldUrl]: 'URL del endpoint',
	[keys.urlInvalid]: 'Introduzca una URL absoluta con http:// o https://.',
	[keys.urlHostNotAllowed]: 'Este host no está en la lista de hosts permitidos para webhooks.',
	[keys.fieldEnabled]: 'Activado',
	[keys.fieldEvents]: 'Eventos',
	[keys.fieldSecret]: 'Secreto de firma',
	[keys.fieldSecretHelp]:
		'Firma las entregas. Se guarda cifrado y no vuelve a mostrarse una vez guardado, así que cópielo ahora en el receptor. Si lo pierde, rótelo en lugar de buscarlo.',
	[keys.fieldPreviousSecretExpires]: 'Secreto anterior válido hasta',
	[keys.fieldPreviousSecretExpiresHelp]:
		'Mientras esté definido, las entregas llevan una firma del secreto actual y otra del anterior. Después de ese momento solo firma el actual.',
	[keys.rotateSecret]: 'Rotar secreto',
	[keys.rotateSecretTitle]: 'Rotar el secreto de firma',
	[keys.rotateSecretAcknowledge]: 'Ya lo he guardado',
	[keys.rotateSecretCopy]: 'Copiar',
	[keys.rotateSecretCopied]: 'Copiado',
	[keys.rotateSecretCopyFailed]:
		'No se pudo copiar automáticamente. Seleccione el secreto y cópielo.',
	[keys.rotateSecretRevealTitle]: 'Nuevo secreto de firma',
	[keys.rotateSecretRevealBody]:
		'Es la única vez que se muestra este secreto. Cópielo en su receptor antes de cerrar este diálogo.',
	[keys.rotateSecretDone]: 'Secreto rotado',
	[keys.rotateSecretFailed]: 'No se pudo rotar el secreto',
	[keys.rotateSecretConfirm]:
		'¿Rotar este secreto de firma? El actual sigue funcionando durante el periodo de gracia y después deja de hacerlo. Verá el nuevo secreto una sola vez.',
	[keys.rotateSecretForbidden]: 'No tiene permiso para rotar este secreto',
	[keys.rotateSecretConflict]:
		'Esta suscripción cambió durante la rotación. Recargue e inténtelo de nuevo si todavía necesita un secreto nuevo',
	[keys.rotateSecretRejected]: 'La rotación fue rechazada. Revise el secreto que ha indicado',
	[keys.fieldHeaders]: 'Cabeceras personalizadas',
	[keys.headerReserved]:
		"El plugin o el transporte HTTP establece '{{name}}' en cada entrega y no se puede sobrescribir.",
	[keys.headerInvalid]:
		"'{{name}}' no es un nombre de cabecera HTTP válido. Use letras, dígitos y cualquiera de !#$%&'*+-.^_`|~ sin espacios.",
	[keys.headerValueInvalid]: 'El valor de una cabecera no puede contener saltos de línea.',
	[keys.fieldDescription]: 'Descripción',
	[keys.statusPending]: 'Pendiente',
	[keys.statusSuccess]: 'Entregada',
	[keys.statusFailed]: 'Fallida',
	[keys.statusDead]: 'Descartada',
	[keys.redeliver]: 'Reenviar',
	[keys.redeliverDone]: 'Reenvío en cola',
	[keys.redeliverSent]: 'Reenviada',
	[keys.redeliverFailed]: 'No se pudo reenviar',
	[keys.redeliverConfirm]:
		'¿Enviar esta carga otra vez? Sale como una entrega nueva con un webhook-id nuevo, así que un receptor que deduplique por el id la procesará por segunda vez.',
}
