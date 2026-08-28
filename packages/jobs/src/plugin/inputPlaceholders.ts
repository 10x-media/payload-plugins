import type { Config, Field } from 'payload'

/** Create-form placeholders for `input`, keyed by task and workflow slug. */
export type JobInputPlaceholders = {
	tasks: Record<string, Record<string, unknown>>
	workflows: Record<string, Record<string, unknown>>
}

/** A hand-written placeholder per slug, replacing the one derived from `inputSchema`. */
export type JobInputExamples = Record<string, Record<string, unknown>>

const relationSample = (relationTo: string | string[]): unknown => {
	if (typeof relationTo === 'string') {
		return `<${relationTo} id>`
	}
	const first = relationTo[0] ?? ''
	return { relationTo: first, value: `<${first} id>` }
}

/**
 * The sample value for one named field. Arrays and `hasMany` fields carry one
 * element so the placeholder shows the element's shape, not just that a list goes
 * there; a relationship names the collection it expects an id from.
 */
const sampleFor = (field: Field): unknown => {
	switch (field.type) {
		case 'number':
			return 0
		case 'checkbox':
			return false
		case 'select':
		case 'radio': {
			const first = field.options[0]
			if (first === undefined) return ''
			return typeof first === 'string' ? first : first.value
		}
		case 'relationship':
		case 'upload':
			return relationSample(field.relationTo)
		case 'json':
		case 'richText':
			return {}
		case 'point':
			return [0, 0]
		case 'array':
			return [derivePlaceholder(field.fields)]
		case 'blocks':
			return []
		case 'group':
			return derivePlaceholder(field.fields)
		default:
			return ''
	}
}

type Entry = [string, unknown]

/**
 * The entries one field contributes: layout-only containers (rows, collapsibles,
 * unnamed groups and tabs) hand their fields' entries up; named groups and tabs
 * contribute one nested object.
 */
const entriesOf = (field: Field): Entry[] => {
	if (field.type === 'ui' || field.type === 'join') return []
	if (field.type === 'tabs') {
		return field.tabs.flatMap((tab): Entry[] =>
			'name' in tab && typeof tab.name === 'string' && tab.name
				? [[tab.name, derivePlaceholder(tab.fields)]]
				: tab.fields.flatMap(entriesOf)
		)
	}
	if (field.type === 'row' || field.type === 'collapsible') return field.fields.flatMap(entriesOf)
	if (!('name' in field) || typeof field.name !== 'string' || !field.name) {
		return field.type === 'group' ? field.fields.flatMap(entriesOf) : []
	}
	const sample = sampleFor(field)
	return [[field.name, 'hasMany' in field && field.hasMany ? [sample] : sample]]
}

/** The placeholder object an `inputSchema` describes. */
export const derivePlaceholder = (fields: Field[] = []): Record<string, unknown> =>
	Object.fromEntries(fields.flatMap(entriesOf))

/**
 * Placeholders for every configured task and workflow. An explicit example for a
 * slug wins over the derived object; an entry without `inputSchema` derives `{}`.
 */
export const collectInputPlaceholders = (
	config: Config,
	examples: JobInputExamples = {}
): JobInputPlaceholders => {
	const from = (entries: { inputSchema?: Field[]; slug: string }[]) =>
		Object.fromEntries(
			entries.map((entry) => [
				entry.slug,
				examples[entry.slug] ?? derivePlaceholder(entry.inputSchema),
			])
		)
	return {
		tasks: from(config.jobs?.tasks ?? []),
		workflows: from(config.jobs?.workflows ?? []),
	}
}
