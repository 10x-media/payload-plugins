import { en } from './en'

export type { TranslationKey } from './keys'
export { keys } from './keys'

/**
 * Flat `automations:foo` entries to the nested `{ automations: { foo } }`
 * shape Payload resolves `t('automations:foo')` against (it splits on `:`).
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

/** Per-locale messages merged into `config.i18n.translations`. English only for now. */
export const translations = {
	en: toNested(en),
}
