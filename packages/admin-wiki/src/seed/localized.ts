import type { WikiSeedContent, WikiSeedLocalized } from './types'

export type LocaleSplit<T> = {
	/** Value written in the default locale (or the only value when not localized). */
	base: T | undefined
	/** Values for every other locale, written with per-locale updates. */
	rest: Record<string, T>
}

const isContent = (value: object): boolean => 'lexical' in value || 'markdown' in value

/**
 * Split a possibly-localized seed value into the default-locale write and the
 * per-locale follow-ups. Content objects (`{markdown}` / `{lexical}`) are
 * single values, everything else object-shaped is a locale record. Locale
 * records against a non-localized project fail loudly.
 */
export const splitLocalized = <T extends string | WikiSeedContent>(
	value: undefined | WikiSeedLocalized<T>,
	defaultLocale: string | undefined,
	label: string
): LocaleSplit<T> => {
	if (value === undefined) {
		return { base: undefined, rest: {} }
	}
	const isRecord = typeof value === 'object' && value !== null && !isContent(value)
	if (!isRecord) {
		return { base: value as T, rest: {} }
	}
	const record = value as Record<string, T>
	if (!defaultLocale) {
		throw new Error(
			`@10x-media/admin-wiki seed: "${label}" is a locale record but the project has no localization`
		)
	}
	const { [defaultLocale]: base, ...rest } = record
	return { base, rest }
}
