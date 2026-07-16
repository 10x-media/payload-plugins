import { keys, type TranslationKey } from './keys'

/**
 * German values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Fields',
	[keys.presets]: 'Voreinstellungen',
	[keys.searchIcons]: 'Icons durchsuchen',
	[keys.noIconsFound]: 'Keine Icons gefunden',
	[keys.browseAll]: 'Alle durchsuchen',
	[keys.recent]: 'Zuletzt verwendet',
	[keys.allIcons]: 'Alle Icons',
	[keys.libraryUnavailable]: 'Diese Icon-Bibliothek ist nicht mehr verfügbar',
	[keys.missingPreset]: 'Voreinstellung fehlt, bitte Ersatz wählen',
	[keys.reveal]: 'Anzeigen',
	[keys.conceal]: 'Verbergen',
	[keys.encryptedValue]: 'Verschlüsselter Wert',
}
