import { keys, type TranslationKey } from './keys'

/**
 * German values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Fields',
	[keys.presets]: 'Voreinstellungen',
	[keys.fieldIconLabel]: 'Icon',
	[keys.fieldIconLibraryLabel]: 'Icon-Bibliothek',
	[keys.selectIcon]: 'Icon auswählen',
	[keys.clearIcon]: 'Icon entfernen',
	[keys.resultsCount]: '{{count}} Icons',
	[keys.textInputPlaceholder]: 'library:icon-name',
	[keys.invalidIconLibrary]: 'Unbekannte Icon-Bibliothek: {{library}}',
	[keys.invalidIconName]: 'Unbekanntes Icon "{{name}}" in Bibliothek {{library}}',
	[keys.invalidIconLibraryValue]: 'Keine registrierte Icon-Bibliothek: {{value}}',
	[keys.searchIcons]: 'Icons durchsuchen',
	[keys.noIconsFound]: 'Keine Icons gefunden',
	[keys.browseAll]: 'Alle durchsuchen',
	[keys.recent]: 'Zuletzt verwendet',
	[keys.allIcons]: 'Alle Icons',
	[keys.iconCategories]: 'Icon-Kategorien',
	[keys.iconGrid]: 'Symbole',
	[keys.libraryUnavailable]:
		'Diese Icon-Bibliothek ist nicht mehr verfügbar. Bitte einen Ersatz wählen.',
	[keys.iconUnavailable]: 'Nicht verfügbar',
	[keys.missingPreset]: 'Fehlende Voreinstellung',
	[keys.preset]: 'Voreinstellung',
	[keys.missingPresetHint]: 'Diese Voreinstellung existiert nicht mehr. Bitte einen Ersatz wählen.',
	[keys.invalidColor]: 'Ungültige Farbe',
	[keys.pickColor]: 'Farbe wählen',
	[keys.clearColor]: 'Farbe entfernen',
	[keys.eyedropperPick]: 'Farbe vom Bildschirm aufnehmen',
	[keys.hue]: 'Farbton',
	[keys.opacity]: 'Deckkraft',
	[keys.saturationBrightness]: 'Sättigung und Helligkeit',
	[keys.format]: 'Format',
	[keys.reveal]: 'Anzeigen',
	[keys.conceal]: 'Verbergen',
	[keys.encryptedValue]: 'Verschlüsselter Wert',
	[keys.richTextApiOnly]:
		'Verschlüsselter Rich-Text wird über die API bearbeitet. Diese Ansicht ist schreibgeschützt.',
}
