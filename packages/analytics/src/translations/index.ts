import { de } from './de'
import { en } from './en'
import type { TranslationKey } from './keys'

export type { TranslationKey } from './keys'
export { keys } from './keys'

/** Per-locale string overrides keyed by this plugin's typed translation keys. */
export type TranslationsOption = {
	[locale: string]: Partial<Record<TranslationKey, string>>
}

/**
 * Flat `analytics:foo` entries to the nested `{ analytics: { foo } }`
 * shape Payload resolves `t('analytics:foo')` against (it splits on `:`).
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

/** Per-locale messages merged into `config.i18n.translations`. */
export const translations = {
	en: toNested(en),
	de: toNested(de),
}
