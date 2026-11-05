import type { Field } from 'payload'

/** Admin widths of the fields a widget form lays out side by side in one row. */
export const HALF = '50%'
export const THIRD = '33.333%'
export const TWO_THIRDS = '66.667%'

/**
 * A field list with its `row` wrappers flattened away, depth first. A row has no name, so a
 * reader looking a field up by name need not know the form's layout.
 */
export const flattenRows = (fields: Field[]): Field[] =>
	fields.flatMap((field) => (field.type === 'row' ? flattenRows(field.fields) : [field]))

/** A field by name, wherever the form's row layout put it. */
export const fieldByName = (fields: Field[], name: string): Field | undefined =>
	flattenRows(fields).find((field) => 'name' in field && field.name === name)
