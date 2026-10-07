import { keys, type TranslationKey } from './keys'

export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Abonnement',
	[keys.subscriptionPlural]: 'Abonnements',
	[keys.deliverySingular]: 'Zustellung',
	[keys.deliveryPlural]: 'Zustellungen',
	[keys.fieldName]: 'Name',
	[keys.fieldUrl]: 'Endpoint-URL',
	[keys.urlInvalid]: 'Geben Sie eine absolute URL mit http:// oder https:// ein.',
	[keys.fieldEnabled]: 'Aktiviert',
	[keys.fieldEvents]: 'Ereignisse',
	[keys.fieldSecret]: 'Signaturgeheimnis',
	[keys.fieldSecretHelp]:
		'Signiert die Zustellungen. Wird verschlüsselt gespeichert und nach dem Speichern nie wieder angezeigt, kopieren Sie es also jetzt zum Empfänger. Geht es verloren, rotieren Sie es, statt danach zu suchen.',
	[keys.fieldPreviousSecretExpires]: 'Vorheriges Geheimnis gültig bis',
	[keys.fieldPreviousSecretExpiresHelp]:
		'Solange gesetzt, tragen Zustellungen je eine Signatur des aktuellen und des vorherigen Geheimnisses. Danach signiert nur noch das aktuelle.',
	[keys.rotateSecret]: 'Geheimnis rotieren',
	[keys.rotateSecretTitle]: 'Signaturgeheimnis rotieren',
	[keys.rotateSecretAcknowledge]: 'Ich habe es gespeichert',
	[keys.rotateSecretCopy]: 'Kopieren',
	[keys.rotateSecretCopied]: 'Kopiert',
	[keys.rotateSecretCopyFailed]:
		'Automatisches Kopieren fehlgeschlagen. Markieren Sie das Geheimnis und kopieren Sie es.',
	[keys.rotateSecretRevealTitle]: 'Neues Signaturgeheimnis',
	[keys.rotateSecretRevealBody]:
		'Dieses Geheimnis wird nur dieses eine Mal angezeigt. Kopieren Sie es in Ihren Empfänger, bevor Sie diesen Dialog schließen.',
	[keys.rotateSecretDone]: 'Geheimnis rotiert',
	[keys.rotateSecretFailed]: 'Das Geheimnis konnte nicht rotiert werden',
	[keys.rotateSecretConfirm]:
		'Dieses Signaturgeheimnis rotieren? Das aktuelle funktioniert noch für die Übergangsfrist und danach nicht mehr. Das neue Geheimnis sehen Sie nur einmal.',
	[keys.rotateSecretForbidden]: 'Sie haben keine Berechtigung, dieses Geheimnis zu rotieren',
	[keys.rotateSecretConflict]:
		'Dieses Abonnement wurde während der Rotation geändert. Laden Sie neu und versuchen Sie es erneut, falls Sie weiterhin ein neues Geheimnis benötigen',
	[keys.rotateSecretRejected]: 'Die Rotation wurde abgelehnt. Prüfen Sie das angegebene Geheimnis',
	[keys.fieldHeaders]: 'Eigene Header',
	[keys.headerReserved]:
		"'{{name}}' wird vom Plugin bei jeder Zustellung gesetzt und kann nicht überschrieben werden.",
	[keys.headerInvalid]:
		"'{{name}}' ist kein gültiger HTTP-Headername. Verwenden Sie Buchstaben, Ziffern und die Zeichen !#$%&'*+-.^_`|~ ohne Leerzeichen.",
	[keys.headerValueInvalid]: 'Ein Header-Wert darf keine Zeilenumbrüche enthalten.',
	[keys.fieldDescription]: 'Beschreibung',
	[keys.statusPending]: 'Ausstehend',
	[keys.statusSuccess]: 'Zugestellt',
	[keys.statusFailed]: 'Fehlgeschlagen',
	[keys.statusDead]: 'Aufgegeben',
	[keys.redeliver]: 'Erneut zustellen',
	[keys.redeliverDone]: 'Erneute Zustellung eingereiht',
	[keys.redeliverFailed]: 'Erneute Zustellung fehlgeschlagen',
	[keys.redeliverConfirm]:
		'Diese Nutzlast erneut senden? Sie geht als neue Zustellung mit neuer webhook-id raus, ein Empfänger, der anhand der ID dedupliziert, verarbeitet sie also ein zweites Mal.',
}
