/**
 * Payload language codes `Intl` cannot read as the language they name, by lowercased spelling: host
 * keys (`zhTw`, `rsLatin`) and Payload's own (`zh-TW`, `rs-latin`). `rs` is Serbian Cyrillic.
 */
const PAYLOAD_LANGUAGES: Readonly<Record<string, string>> = {
	zhtw: 'zh-TW',
	bnbd: 'bn-BD',
	bnin: 'bn-IN',
	rs: 'sr-Cyrl',
	rslatin: 'sr-Latn',
	'rs-latin': 'sr-Latn',
}

const FALLBACK = 'en'

/**
 * BCP 47 tag `Intl` formats a Payload language in, or `en` for one it refuses or lacks, so a render
 * never throws and server and browser agree. Label maps keep the raw Payload code.
 */
export const intlLocale = (language: string | null | undefined): string => {
	if (typeof language !== 'string' || language.trim() === '') {
		return FALLBACK
	}
	const tag = PAYLOAD_LANGUAGES[language.trim().toLowerCase()] ?? language.trim()
	try {
		const [canonical] = Intl.getCanonicalLocales(tag)
		return canonical !== undefined && Intl.NumberFormat.supportedLocalesOf([canonical]).length > 0
			? canonical
			: FALLBACK
	} catch {
		return FALLBACK
	}
}

/** Formatters are costly to build and asked for per row; past this many kept, a kind starts over. */
const MAX_KEPT = 200

type Language = string | null | undefined

/**
 * One formatter per language and options. One refusing its locale falls back to `en`; one refusing
 * `en` too (unknown currency or zone) throws, as the options are at fault.
 */
const memo = <O extends object, T>(make: (locale: string, options: O | undefined) => T) => {
	const kept = new Map<string, T>()
	return (language: Language, options?: O): T => {
		const locale = intlLocale(language)
		const key = options === undefined ? locale : `${locale}|${JSON.stringify(options)}`
		const hit = kept.get(key)
		if (hit !== undefined) {
			return hit
		}
		let made: T
		try {
			made = make(locale, options)
		} catch {
			made = make(FALLBACK, options)
		}
		if (kept.size >= MAX_KEPT) {
			kept.clear()
		}
		kept.set(key, made)
		return made
	}
}

export const numberFormat = memo<Intl.NumberFormatOptions, Intl.NumberFormat>(
	(locale, options) => new Intl.NumberFormat(locale, options)
)

export const dateTimeFormat = memo<Intl.DateTimeFormatOptions, Intl.DateTimeFormat>(
	(locale, options) => new Intl.DateTimeFormat(locale, options)
)

export const pluralRules = memo<Intl.PluralRulesOptions, Intl.PluralRules>(
	(locale, options) => new Intl.PluralRules(locale, options)
)

export const listFormat = memo<Intl.ListFormatOptions, Intl.ListFormat>(
	(locale, options) => new Intl.ListFormat(locale, options)
)

export const relativeTimeFormat = memo<Intl.RelativeTimeFormatOptions, Intl.RelativeTimeFormat>(
	(locale, options) => new Intl.RelativeTimeFormat(locale, options)
)

export const collator = memo<Intl.CollatorOptions, Intl.Collator>(
	(locale, options) => new Intl.Collator(locale, options)
)

const names = memo<Intl.DisplayNamesOptions, Intl.DisplayNames | null>((locale, options) =>
	options === undefined ? null : new Intl.DisplayNames([locale], options)
)

/** Null where the runtime has no display names of this type at all. */
export const displayNames = (
	language: Language,
	options: Intl.DisplayNamesOptions
): Intl.DisplayNames | null => {
	try {
		return names(language, options)
	} catch {
		return null
	}
}
