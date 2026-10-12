/**
 * A name GA4 accepts (a letter first, then letters, digits and underscores, at most 40), so a
 * kebab-case slug lands with underscores. Imports nothing: the browser tracker bundles it.
 */
export const ga4EventName = (name: string): string => {
	const cleaned = name.replace(/-/g, '_').replace(/[^A-Za-z0-9_]/g, '')
	return (/^[A-Za-z]/.test(cleaned) ? cleaned : `e_${cleaned}`).slice(0, 40)
}
