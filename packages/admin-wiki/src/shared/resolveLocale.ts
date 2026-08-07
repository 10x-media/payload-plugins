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
