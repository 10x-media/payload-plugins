import type { Field } from 'payload'

/**
 * Replaces a plugin collection's default field, passed in so an override can spread it. May return
 * any field type, layouts included, if each field the collection needs by name stays inside.
 */
export type CollectionFieldOverride = (args: { field: Field }) => Field

export const overrideField = (field: Field, fn: CollectionFieldOverride | undefined): Field =>
	fn ? fn({ field }) : field

/** True for a field that can share a `row` with another: named, and not sidebar-bound. */
const rowable = (field: Field): boolean => 'name' in field && field.admin?.position !== 'sidebar'

/** Whether a field of this name exists anywhere in the tree, rows and tabs included. */
export const hasNamedField = (fields: Field[], name: string): boolean =>
	fields.some(
		(field) =>
			('name' in field && field.name === name) ||
			('fields' in field && Array.isArray(field.fields) && hasNamedField(field.fields, name)) ||
			('tabs' in field && field.tabs.some((tab) => hasNamedField(tab.fields, name)))
	)

/**
 * Pairs two overridable fields in one `row` while both stay plain named fields. A layout or sidebar
 * replacement cannot live in a row, so it goes to top level with its declared position.
 */
export const pairInRow = (first: Field, second: Field): Field[] => {
	const paired = [first, second].filter(rowable)
	const loose = [first, second].filter((field) => !rowable(field))
	return [...(paired.length > 0 ? [{ type: 'row' as const, fields: paired }] : []), ...loose]
}
