import type { SanitizedConfig } from 'payload'

/** A plain language tag (`uk`, `pt-BR`, `zh_Hant`), bounded so a stored locale stays a short identifier. */
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8}){0,4}$/

/**
 * The locale a submission is stored and processed under, from the visitor-controlled `req.locale`.
 * On a localized host only a configured locale code is accepted, anything else (`all`, `*`, a code
 * outside `localeCodes`, which Payload passes through when `localization.fallback` is false) becomes
 * the default locale. Without localization any plain language tag is kept, so a `richText.serialize`
 * wrapper can still localize its own strings, and anything else becomes `'en'`.
 */
export const resolveSubmissionLocale = (
	locale: unknown,
	localization: SanitizedConfig['localization']
): string => {
	if (localization) {
		return typeof locale === 'string' && localization.localeCodes.includes(locale)
			? locale
			: localization.defaultLocale
	}
	return typeof locale === 'string' && locale !== 'all' && LOCALE_TAG.test(locale) ? locale : 'en'
}
