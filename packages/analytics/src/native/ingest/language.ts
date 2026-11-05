/** Long enough for any real BCP 47 tag; a longer one is junk, not a language. */
export const MAX_LANGUAGE_LENGTH = 16

/**
 * First `Accept-Language` tag without its quality factor, lowercased (`de-DE,de;q=0.9` gives
 * `de-de`). A wildcard or absent header states no preference.
 */
export const primaryLanguage = (acceptLanguage: string | null): string | undefined => {
	const tag = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim().toLowerCase()
	if (!tag || tag === '*') {
		return undefined
	}
	return tag.slice(0, MAX_LANGUAGE_LENGTH)
}
