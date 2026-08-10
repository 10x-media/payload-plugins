import type { FlattenedField } from 'payload'

/**
 * Rows, collapsibles, and unnamed tabs are already inlined by Payload's
 * flattening, so each dot segment only ever names a data field or a named
 * container (group, named tab, array) carrying nested flattenedFields.
 */
export const findNamedField = (
	fields: FlattenedField[] | undefined,
	path: string
): FlattenedField | undefined => {
	let scope = fields
	let found: FlattenedField | undefined
	for (const segment of path.split('.')) {
		found = scope?.find((field) => field.name === segment)
		if (!found) return undefined
		scope = 'flattenedFields' in found ? found.flattenedFields : undefined
	}
	return found
}

/**
 * Walks a dot path over doc data. The array guard rejects indexing *into* an
 * array, so a path ending at an array field still returns the array itself.
 */
export const readPath = (doc: Record<string, unknown>, path: string): unknown => {
	let value: unknown = doc
	for (const segment of path.split('.')) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
		value = (value as Record<string, unknown>)[segment]
	}
	return value
}
