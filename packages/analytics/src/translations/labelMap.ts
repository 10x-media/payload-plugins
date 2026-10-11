/**
 * Payload's `i18n.fallbackLanguage`: one language, or several in order.
 *
 * @internal
 */
export type FallbackLanguage = string | readonly string[] | undefined

const filled = (value: string | undefined): value is string =>
	typeof value === 'string' && value.trim() !== ''

/**
 * Label for the reader's language, then the configured fallback (as Payload's `getTranslation`
 * reads it), then English. Blank entries count as none; undefined when none is usable.
 */
export const pickLabel = (
	map: Readonly<Record<string, string | undefined>> | undefined,
	language: string | undefined,
	fallbackLanguage?: FallbackLanguage
): string | undefined => {
	if (map === undefined) {
		return undefined
	}
	const fallbacks = typeof fallbackLanguage === 'string' ? [fallbackLanguage] : fallbackLanguage
	const order = [language, ...(fallbacks ?? []), 'en']
	for (const code of order) {
		const value = code === undefined ? undefined : map[code]
		if (filled(value)) {
			return value
		}
	}
	return undefined
}
