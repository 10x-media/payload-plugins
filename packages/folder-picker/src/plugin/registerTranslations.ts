import type { Config } from 'payload'
import { deepMergeSimple } from 'payload/shared'

import { type TranslationsOption, toNested, translations } from '../translations'

type Translations = NonNullable<NonNullable<Config['i18n']>['translations']>

/**
 * Merge this plugin's translations into the host config. Plugin-level
 * `overrides` win over the built-ins key-by-key and may add locales the plugin
 * does not ship. A host value wins over both (`deepMergeSimple` lets the second
 * argument override), so projects can override any string.
 */
export const registerTranslations = (config: Config, overrides?: TranslationsOption): void => {
	const nested: Record<string, Record<string, Record<string, string>>> = {}
	for (const [locale, flat] of Object.entries(overrides ?? {})) {
		nested[locale] = toNested(flat)
	}
	config.i18n ??= {}
	config.i18n.translations = deepMergeSimple<Translations>(
		deepMergeSimple(translations, nested),
		config.i18n.translations ?? {}
	)
}
