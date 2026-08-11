import type { TypedLocale } from 'payload'

/**
 * A locale code resolved at runtime, seen as the host's locale union.
 *
 * Every locale the plugin handles comes from the running config, the request,
 * or seed input, so it is a string. A project that generated its types narrows
 * each Payload locale argument to a union of its own locales, which no runtime
 * value can be narrowed to, so the assertion lives here once instead of at
 * every call.
 */
export const asLocale = (locale: string): TypedLocale => locale as TypedLocale

export type ResolveLocaleArgs = {
	/** Content locale codes the project declares, empty when not localized. */
	contentLocales: string[]
	defaultLocale: string | undefined
	/** The reader's admin UI language (`i18n.language`). */
	language: string | undefined
	/** Admin language to content locale mapping from plugin options. */
	localeMap: Record<string, string>
}

/**
 * Resolve the content locale a reader's guides load in: their admin language
 * through the localeMap, the language itself when it is a content locale, then
 * the default locale. Returns undefined for non-localized projects.
 */
export const resolveReaderLocale = ({
	contentLocales,
	defaultLocale,
	language,
	localeMap,
}: ResolveLocaleArgs): string | undefined => {
	if (contentLocales.length === 0) {
		return undefined
	}
	if (language) {
		const mapped = localeMap[language]
		if (mapped && contentLocales.includes(mapped)) {
			return mapped
		}
		if (contentLocales.includes(language)) {
			return language
		}
	}
	return defaultLocale
}
