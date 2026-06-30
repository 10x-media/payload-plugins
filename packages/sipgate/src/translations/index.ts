import { de } from './de'
import { en } from './en'

export type { TranslationKey } from './keys'
export { keys } from './keys'

/**
 * Flat `sipgate:foo` entries to the nested `{ sipgate: { foo } }`
 * shape Payload resolves `t('sipgate:foo')` against (it splits on `:`).
 */
const toNested = (flat: Record<string, string>): Record<string, Record<string, string>> => {
	const out: Record<string, Record<string, string>> = {}
	for (const [fullKey, value] of Object.entries(flat)) {
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
