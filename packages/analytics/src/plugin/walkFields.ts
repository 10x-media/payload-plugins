import type { Field } from 'payload'

const children = (field: Field): Field[] => {
	const out: Field[] = []
	if ('fields' in field && Array.isArray(field.fields)) {
		out.push(...field.fields)
	}
	if ('tabs' in field && Array.isArray(field.tabs)) {
		for (const tab of field.tabs) {
			out.push(...tab.fields)
		}
	}
	// `blockReferences` names blocks defined elsewhere in the config, and those are walked
	// where they are defined rather than once per field that names them.
	if ('blocks' in field && Array.isArray(field.blocks)) {
		for (const block of field.blocks) {
			out.push(...block.fields)
		}
	}
	return out
}

/**
 * Every field of a tree, parents first, through rows, collapsibles, groups, arrays, tabs and inline
 * blocks. Depth-first, so a caller keeping the first match keeps the one nearest the top.
 */
export function* walkFields(fields: Field[]): Generator<Field> {
	for (const field of fields) {
		yield field
		yield* walkFields(children(field))
	}
}
