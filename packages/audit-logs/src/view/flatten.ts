const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * A nested value as dotted paths and their leaves, in the shape the diff table
 * reads: `seo.title`, `sections.0.heading`. Empty objects and arrays stay leaves,
 * so they still show up rather than vanishing.
 */
export const flattenEntries = (value: unknown, prefix = ''): [string, unknown][] => {
	const children = isPlainObject(value)
		? Object.entries(value)
		: Array.isArray(value)
			? value.map((item, index): [string, unknown] => [String(index), item])
			: []
	if (children.length === 0) return prefix ? [[prefix, value]] : []
	return children.flatMap(([key, child]) =>
		flattenEntries(child, prefix ? `${prefix}.${key}` : key)
	)
}
