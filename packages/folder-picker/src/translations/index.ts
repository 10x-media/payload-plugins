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

export type { TranslationKey } from './keys'
export { keys } from './keys'

/** Per-locale string overrides keyed by this plugin's typed translation keys. */
export type TranslationsOption = {
	[locale: string]: Partial<Record<TranslationKey, string>>
}

/**
 * Flat `folderPicker:foo` entries to the nested `{ folderPicker: { foo } }`
 * shape Payload resolves `t('folderPicker:foo')` against (it splits on `:`).
 * Undefined values are skipped so `Partial` override maps pass through.
 * A key with no `:` has no namespace to nest under, so it is dropped rather than
 * split at -1, which would file it under the key with its last character shaved off.
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
		if (separator < 1) {
			continue
		}
		const namespace = fullKey.slice(0, separator)
		const bucket = out[namespace] ?? {}
		bucket[fullKey.slice(separator + 1)] = value
		out[namespace] = bucket
	}
	return out
}

/** Per-locale messages merged into `config.i18n.translations`. */
export const translations = {
	ar: toNested(ar),
	de: toNested(de),
	en: toNested(en),
	es: toNested(es),
	fr: toNested(fr),
	id: toNested(id),
	pt: toNested(pt),
	ru: toNested(ru),
	uk: toNested(uk),
	zh: toNested(zh),
}
