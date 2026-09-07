/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale, or it is a type error.
 *
 * The appearance item deliberately has no keys of its own beyond its label: its
 * controls reuse Payload's `general:` strings so the panel and `/admin/account`
 * can never disagree on what "Automatic" is called.
 */
export const keys = {
	pluginName: 'settingsOverlay:pluginName',
	appearanceLabel: 'settingsOverlay:appearanceLabel',
	back: 'settingsOverlay:back',
	close: 'settingsOverlay:close',
	discardBody: 'settingsOverlay:discardBody',
	discardConfirm: 'settingsOverlay:discardConfirm',
	discardHeading: 'settingsOverlay:discardHeading',
	empty: 'settingsOverlay:empty',
	loadFailed: 'settingsOverlay:loadFailed',
	noResults: 'settingsOverlay:noResults',
	searchPlaceholder: 'settingsOverlay:searchPlaceholder',
	widgetNotice: 'settingsOverlay:widgetNotice',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
