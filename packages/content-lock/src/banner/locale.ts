/**
 * The content locale a viewer's banner messages load in: their admin language
 * through `localeMap`, the language itself when it is a content locale, then
 * the default locale. `undefined` for a project without localization.
 */
export const resolveMessageLocale = ({
	contentLocales,
	defaultLocale,
	language,
	localeMap,
}: {
	/** Content locale codes the project declares, empty when not localized. */
	contentLocales: readonly string[]
	defaultLocale: string | undefined
	/** The viewer's admin language (`i18n.language`). */
	language: string
	localeMap: Readonly<Record<string, string>>
}): string | undefined => {
	if (contentLocales.length === 0) {
		return undefined
	}
	const mapped = localeMap[language]
	if (mapped && contentLocales.includes(mapped)) {
		return mapped
	}
	if (contentLocales.includes(language)) {
		return language
	}
	return defaultLocale
}

/**
 * The admin language whose labels suit a content locale: the `localeMap` key
 * pointing at it, else the locale code itself. Used to read labels (group,
 * collection) in the language a message is written in.
 */
export const languageForLocale = (
	locale: string,
	localeMap: Readonly<Record<string, string>>
): string => Object.entries(localeMap).find(([, mapped]) => mapped === locale)?.[0] ?? locale

/**
 * `preferred` when `Intl` knows it, else `fallback`. Content locale codes are
 * the project's own keys and need not be language tags.
 */
export const intlLanguage = (preferred: string | undefined, fallback: string): string => {
	if (!preferred) {
		return fallback
	}
	try {
		return Intl.DateTimeFormat.supportedLocalesOf(preferred).length > 0 ? preferred : fallback
	} catch {
		return fallback
	}
}
