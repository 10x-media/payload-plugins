type SearchParams = Record<string, string | string[] | undefined>

const INDEXED_KEY = /^([^[\]]+)\[(\d+)\]$/

/**
 * Folds `key[0]`, `key[1]` entries back into one `key` array.
 *
 * Next hands a view a repeated query key as an array. TanStack Start (4.0.0-beta.7) serializes
 * the router's search with `qs` indices and then flattens it with `URLSearchParams`, so the same
 * URL arrives as `{ 'operation[0]': 'update', 'operation[1]': 'delete' }`. Keys nested deeper
 * than one index are left as they are.
 */
export const normalizeSearchParams = (searchParams: SearchParams = {}): SearchParams => {
	const result: SearchParams = {}
	const indexed = new Map<string, [number, string][]>()
	for (const [key, value] of Object.entries(searchParams)) {
		const match = INDEXED_KEY.exec(key)
		if (match && typeof value === 'string') {
			const [, base = key, index = '0'] = match
			const list = indexed.get(base) ?? []
			list.push([Number(index), value])
			indexed.set(base, list)
		} else {
			result[key] = value
		}
	}
	for (const [base, entries] of indexed) {
		const values = entries.sort((a, b) => a[0] - b[0]).map(([, value]) => value)
		const existing = result[base]
		result[base] = [...(existing === undefined ? [] : [existing].flat()), ...values]
	}
	return result
}
