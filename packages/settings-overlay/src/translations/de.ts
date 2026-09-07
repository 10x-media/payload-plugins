import { keys, type TranslationKey } from './keys'

export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Einstellungs-Overlay',
	[keys.appearanceLabel]: 'Darstellung',
	[keys.back]: 'Zurück',
	[keys.close]: 'Schließen',
	[keys.discardBody]: 'Es gibt ungespeicherte Änderungen. Wenn du jetzt gehst, gehen sie verloren.',
	[keys.discardConfirm]: 'Änderungen verwerfen',
	[keys.discardHeading]: 'Änderungen verwerfen?',
	[keys.empty]: 'Hier gibt es noch nichts zu sehen.',
	[keys.loadFailed]: 'Konnte nicht geladen werden. Bitte erneut versuchen.',
	[keys.noResults]: 'Keine Treffer.',
	[keys.searchPlaceholder]: 'Suchen',
	[keys.widgetNotice]:
		'Dieses Widget ist nicht zur Anzeige gedacht. Sie können es vom Dashboard entfernen.',
}
