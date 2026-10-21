import { keys, type TranslationKey } from './keys'

/** German values. The `Record<TranslationKey, string>` annotation makes a missing key a type error. */
export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Feedback-Recorder',
	[keys.openRecorder]: 'Bildschirm für das 10x-Media-Team aufnehmen',
	[keys.drawerTitle]: 'Aufnahme an 10x Media senden',
	[keys.tabNew]: 'Neue Aufnahme',
	[keys.tabMine]: 'Meine Aufnahmen',
	[keys.intro]:
		'Zeigen Sie uns, was Sie meinen: Bildschirm aufnehmen und dabei erklären. Die Aufnahme geht direkt an das 10x-Media-Team.',
	[keys.kindLabel]: 'Worum geht es?',
	[keys.kindBug]: 'Etwas funktioniert nicht',
	[keys.kindQuestion]: 'Eine Frage',
	[keys.kindIdea]: 'Eine Idee oder ein Wunsch',
	[keys.kindFeedback]: 'Allgemeines Feedback',
	[keys.cameraToggle]: 'Meine Kamera in der Aufnahme zeigen',
	[keys.cameraPreview]: 'Kameravorschau',
	[keys.cameraHint]:
		'Prüfen Sie, ob Sie gut im Bild sind. Die Position der Kamerablase wählen Sie, nachdem Sie den Bildschirm ausgewählt haben.',
	[keys.cameraUnavailable]: 'Die Kamera ist nicht verfügbar. Die Aufnahme läuft ohne sie.',
	[keys.start]: 'Aufnahme starten',
	[keys.uploadInstead]: 'Oder eine Videodatei senden',
	[keys.privacyHint]:
		'Aufgenommen werden Ihr Bildschirm, Ihr Mikrofon und, falls eingeschaltet, Ihre Kamera. Zeigen Sie nur, was Sie teilen dürfen.',
	[keys.requesting]:
		'Wählen Sie im Dialog des Browsers den Bildschirm, das Fenster oder den Tab aus.',
	[keys.countdown]: 'Aufnahme beginnt in {{seconds}} …',
	[keys.recording]: 'Aufnahme läuft',
	[keys.paused]: 'Pausiert',
	[keys.pause]: 'Pausieren',
	[keys.resume]: 'Fortsetzen',
	[keys.stop]: 'Beenden',
	[keys.discard]: 'Verwerfen',
	[keys.micLevel]: 'Mikrofonpegel',
	[keys.micSilent]: 'Wir hören Sie nicht. Bitte prüfen Sie Ihr Mikrofon.',
	[keys.placeHeading]: 'Kamera platzieren',
	[keys.placeCanvas]: 'Aufnahmevorschau mit Ihrer Kamera',
	[keys.placeHint]:
		'Ziehen Sie den Kreis oder nutzen Sie die Pfeiltasten. Plus und Minus ändern die Größe.',
	[keys.placeConfirm]: 'Starten',
	[keys.reviewHeading]: 'Aufnahme prüfen',
	[keys.titleLabel]: 'Titel',
	[keys.titlePlaceholder]: 'In wenigen Worten: Worum geht es?',
	[keys.noteLabel]: 'Möchten Sie etwas ergänzen?',
	[keys.send]: 'An 10x Media senden',
	[keys.saveCopy]: 'Kopie speichern',
	[keys.uploading]: 'Wird gesendet … {{percent}} %',
	[keys.processing]: 'Fast fertig …',
	[keys.ready]: 'Gesendet. Das 10x-Media-Team hat Ihre Aufnahme erhalten.',
	[keys.recordAnother]: 'Weitere Aufnahme',
	[keys.retry]: 'Erneut versuchen',
	[keys.errorUnsupported]:
		'Dieser Browser kann den Bildschirm nicht aufnehmen. Nutzen Sie ein aktuelles Chrome, Edge oder Firefox am Computer, oder senden Sie eine Videodatei.',
	[keys.errorPermission]:
		'Die Bildschirmfreigabe wurde nicht erlaubt. Starten Sie erneut und wählen Sie aus, was geteilt werden soll.',
	[keys.errorRecording]: 'Die Aufnahme wurde unerwartet beendet.',
	[keys.errorReserve]:
		'Das 10x-Media-System war nicht erreichbar. Ihre Aufnahme bleibt erhalten: Erneut versuchen oder eine Kopie speichern.',
	[keys.errorUpload]:
		'Der Upload wurde unterbrochen. Ihre Aufnahme bleibt erhalten: Erneut versuchen setzt ihn fort.',
	[keys.errorComplete]:
		'Der Upload ist fertig, konnte aber nicht bestätigt werden. Bitte erneut versuchen.',
	[keys.mineEmpty]: 'Sie haben noch keine Aufnahmen gesendet.',
	[keys.mineFailed]: 'Ihre Aufnahmen konnten nicht geladen werden.',
	[keys.mineLoading]: 'Wird geladen …',
	[keys.triageNew]: 'Eingegangen',
	[keys.triageSeen]: 'Vom Team gesehen',
	[keys.triageInProgress]: 'In Bearbeitung',
	[keys.triageDone]: 'Erledigt',
	[keys.statusProcessing]: 'Wird verarbeitet',
	[keys.statusFailed]: 'Konnte nicht verarbeitet werden',
	[keys.leaveWarning]: 'Eine Aufnahme wird noch gesendet. Trotzdem verlassen?',
}
