import type { SanitizedConfig } from 'payload'

/** A plain language tag (`uk`, `pt-BR`, `zh-Hant`), bounded so a stored locale stays a short identifier. */
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/

/**
 * `locale` as a canonical BCP-47 tag, or `undefined` when it is not one. An underscore separator
 * (`zh_Hant`) is normalized to a hyphen first: the stored value reaches `Intl` consumers (a field
 * type's `format`), and `Intl` throws a `RangeError` on an underscore.
 */
const canonicalTag = (locale: string): string | undefined => {
	const tag = locale.replaceAll('_', '-')
	if (tag === 'all' || !LOCALE_TAG.test(tag)) {
		return undefined
	}
	try {
		return Intl.getCanonicalLocales(tag)[0]
	} catch {
		return undefined
	}
}

/**
 * The locale a submission is stored and processed under, from the visitor-controlled `req.locale`.
 * On a localized host only a configured locale code is accepted, anything else (`all`, `*`, a code
 * outside `localeCodes`, which Payload passes through when `localization.fallback` is false) becomes
 * the default locale. Without localization any valid language tag is kept in its canonical form, so a
 * `richText.serialize` wrapper can still localize its own strings, and anything else becomes `'en'`.
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
	return (typeof locale === 'string' ? canonicalTag(locale) : undefined) ?? 'en'
}

/**
 * `req.context` key carrying `createSubmission`'s explicit `locale` into the create hook. The local
 * API drops its own `locale` arg on a host without localization, so the context is the one channel
 * that reaches `validateSubmission` either way. Read once and removed there, so it cannot leak into
 * a later create on the same request.
 */
export const SUBMISSION_LOCALE_CONTEXT_KEY = 'formBuilderSubmissionLocale'
