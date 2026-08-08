/** Kebab-case a string into a URL-safe slug. */
export const slugify = (value: string): string =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
