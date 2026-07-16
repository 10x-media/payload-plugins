/**
 * Parses an `application/x-www-form-urlencoded` body into an object.
 *
 * Keys ending in `[]` (sipgate's array fields, e.g. `userId[]`) always map to an
 * array, matching sipgate's webhook payload shape. Other repeated keys also map
 * to arrays; single occurrences map to a scalar string.
 */
export const parseFormBody = (body: string): Record<string, string | string[]> => {
	const params = new URLSearchParams(body)
	const result: Record<string, string | string[]> = {}
	for (const key of new Set(params.keys())) {
		const values = params.getAll(key)
		result[key] = key.endsWith('[]') || values.length > 1 ? values : (values[0] ?? '')
	}
	return result
}
