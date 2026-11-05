import { translations } from './index'
import type { TranslationKey } from './keys'

type Nested = Record<string, Record<string, Record<string, unknown> | undefined> | undefined>

const valueIn = (source: unknown, locale: string, key: TranslationKey): string | undefined => {
	const separator = key.indexOf(':')
	const value = (source as Nested | null | undefined)?.[locale]?.[key.slice(0, separator)]?.[
		key.slice(separator + 1)
	]
	return typeof value === 'string' ? value : undefined
}

/**
 * Resolve a plugin string in `locale`, falling back to English. Pass the config's
 * `i18n.translations` as `source` so host and `translations` option overrides apply; the plugin's
 * bundled strings back it.
 */
export const messageFor = (
	locale: null | string | undefined,
	key: TranslationKey,
	source?: unknown
): string => {
	const code = (locale ?? 'en').split('-')[0] ?? 'en'
	return (
		valueIn(source, code, key) ??
		valueIn(translations, code, key) ??
		valueIn(source, 'en', key) ??
		valueIn(translations, 'en', key) ??
		key
	)
}

/** Replace every `token` without interpreting `$` in `value`. */
export const fillTemplate = (template: string, token: string, value: string): string =>
	template.split(token).join(value)
