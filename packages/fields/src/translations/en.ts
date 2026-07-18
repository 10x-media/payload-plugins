import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Fields',
	[keys.presets]: 'Presets',
	[keys.fieldIconLabel]: 'Icon',
	[keys.fieldIconLibraryLabel]: 'Icon library',
	[keys.selectIcon]: 'Select icon',
	[keys.clearIcon]: 'Clear icon',
	[keys.resultsCount]: '{{count}} icons',
	[keys.textInputPlaceholder]: 'library:icon-name',
	[keys.invalidIconLibrary]: 'Unknown icon library: {{library}}',
	[keys.invalidIconName]: 'Unknown icon "{{name}}" in library {{library}}',
	[keys.invalidIconLibraryValue]: 'Not a registered icon library: {{value}}',
	[keys.searchIcons]: 'Search icons',
	[keys.noIconsFound]: 'No icons found',
	[keys.browseAll]: 'Browse all',
	[keys.recent]: 'Recent',
	[keys.allIcons]: 'All icons',
	[keys.iconCategories]: 'Icon categories',
	[keys.iconGrid]: 'Icons',
	[keys.libraryUnavailable]: 'This icon library is no longer available. Choose a replacement.',
	[keys.iconUnavailable]: 'Unavailable',
	[keys.missingPreset]: 'Missing preset',
	[keys.preset]: 'Preset',
	[keys.missingPresetHint]: 'This preset no longer exists. Pick a replacement.',
	[keys.invalidColor]: 'Invalid color',
	[keys.pickColor]: 'Pick a color',
	[keys.clearColor]: 'Clear color',
	[keys.eyedropperPick]: 'Pick color from screen',
	[keys.hue]: 'Hue',
	[keys.opacity]: 'Opacity',
	[keys.saturationBrightness]: 'Saturation and brightness',
	[keys.format]: 'Format',
	[keys.reveal]: 'Reveal',
	[keys.conceal]: 'Conceal',
	[keys.encryptedValue]: 'Encrypted value',
}
