/** Kebab-case a string into a URL-safe slug. */
export const slugify = (value: string): string =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
