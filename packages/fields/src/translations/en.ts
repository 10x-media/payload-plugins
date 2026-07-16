import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Fields',
	[keys.presets]: 'Presets',
	[keys.searchIcons]: 'Search icons',
	[keys.noIconsFound]: 'No icons found',
	[keys.browseAll]: 'Browse all',
	[keys.recent]: 'Recent',
	[keys.allIcons]: 'All icons',
	[keys.libraryUnavailable]: 'This icon library is no longer available',
	[keys.missingPreset]: 'Missing preset, pick a replacement',
	[keys.reveal]: 'Reveal',
	[keys.conceal]: 'Conceal',
	[keys.encryptedValue]: 'Encrypted value',
}
