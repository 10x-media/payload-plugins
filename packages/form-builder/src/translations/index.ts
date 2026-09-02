import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import type { TranslationKey } from './keys'
import { pt } from './pt'
import { ru } from './ru'
import { uk } from './uk'
import { zh } from './zh'

export { ar } from './ar'
export { de } from './de'
export { en } from './en'
export { es } from './es'
export { fr } from './fr'
export { id } from './id'
export type { TranslationKey } from './keys'
export { keys } from './keys'
export { pt } from './pt'
export { ru } from './ru'
export { uk } from './uk'
export { zh } from './zh'

/** A complete flat map of every typed key to its string, for one locale. */
export type TranslationBundle = Record<TranslationKey, string>

/**
 * Every locale bundle this plugin ships, keyed by locale code. The single source both the nested
 * Payload `translations` map and the `/react` + `/i18n` bundle exports derive from: register a new
 * locale here once and it flows to both. A host bridging its own translator can fall back through a
 * complete bundle (`makeTranslate(locale)`), so a visitor's locale never silently resolves to English.
 */
export const bundles: Record<string, TranslationBundle> = {
	ar,
	de,
	en,
	es,
	fr,
	id,
	pt,
	ru,
	uk,
	zh,
}

/** Per-locale string overrides keyed by this plugin's typed translation keys. */
export type TranslationsOption = {
	[locale: string]: Partial<Record<TranslationKey, string>>
}

/**
 * Flat `formBuilder:foo` entries to the nested `{ formBuilder: { foo } }`
 * shape Payload resolves `t('formBuilder:foo')` against (it splits on `:`).
 * Undefined values are skipped so `Partial` override maps pass through.
 */
export const toNested = (flat: {
	[key: string]: string | undefined
}): Record<string, Record<string, string>> => {
	const out: Record<string, Record<string, string>> = {}
	for (const [fullKey, value] of Object.entries(flat)) {
		if (typeof value !== 'string') {
			continue
		}
		const separator = fullKey.indexOf(':')
		const namespace = fullKey.slice(0, separator)
		const bucket = out[namespace] ?? {}
		bucket[fullKey.slice(separator + 1)] = value
		out[namespace] = bucket
	}
	return out
}

/** Per-locale messages merged into `config.i18n.translations`, derived from `bundles`. */
export const translations: Record<
	string,
	Record<string, Record<string, string>>
> = Object.fromEntries(
	Object.entries(bundles).map(([locale, bundle]) => [locale, toNested(bundle)])
)
