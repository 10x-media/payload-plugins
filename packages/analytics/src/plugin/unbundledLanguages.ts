import type { Config } from 'payload'
import { deepMergeSimple } from 'payload/shared'

import { translations } from '../translations'

type Translations = NonNullable<NonNullable<Config['i18n']>['translations']>

const bundled = new Set(Object.keys(translations))

/**
 * Host admin languages this plugin ships no strings for. Payload reads a request's strings from
 * `config.i18n.translations[language]` alone, so such a language would show raw keys.
 */
export const unbundledLanguages = (config: Config): string[] =>
	Object.keys(config.i18n?.supportedLanguages ?? {}).filter((language) => !bundled.has(language))

/**
 * Gives each {@link unbundledLanguages} entry English strings beneath whatever host or
 * `translations` option set, which win key by key. Must run after `registerTranslations`.
 */
export const fillUnbundledLanguages = (config: Config): void => {
	const missing = unbundledLanguages(config)
	if (missing.length === 0) {
		return
	}
	const english: Record<string, Record<string, Record<string, string>>> = {}
	for (const language of missing) {
		english[language] = Object.fromEntries(
			Object.entries(translations.en).map(([namespace, strings]) => [namespace, { ...strings }])
		)
	}
	config.i18n ??= {}
	config.i18n.translations = deepMergeSimple<Translations>(english, config.i18n.translations ?? {})
}
