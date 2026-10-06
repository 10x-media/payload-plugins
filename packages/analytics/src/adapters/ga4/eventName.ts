/**
 * A name GA4 accepts for an event. GA4 takes names that start with a letter and carry only
 * letters, digits and underscores, up to 40 characters
 * (https://support.google.com/analytics/answer/13316687,
 * https://support.google.com/analytics/answer/9267744), so a kebab-case goal slug such as
 * `checkout-complete` never lands as authored: hyphens become underscores, anything else
 * outside the alphabet is dropped, and a name that would not start with a letter is prefixed.
 *
 * Imports nothing, because the browser tracker bundles it alongside the sink.
 */
export const ga4EventName = (name: string): string => {
	const cleaned = name.replace(/-/g, '_').replace(/[^A-Za-z0-9_]/g, '')
	return (/^[A-Za-z]/.test(cleaned) ? cleaned : `e_${cleaned}`).slice(0, 40)
}
