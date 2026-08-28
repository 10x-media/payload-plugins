import type { Config, Field } from 'payload'
import { fieldAffectsData, fieldIsPresentationalOnly, tabHasName } from 'payload/shared'

/** Create-form placeholders for `input`, keyed by task and workflow slug. */
export type JobInputPlaceholders = {
	tasks: Record<string, Record<string, unknown>>
	workflows: Record<string, Record<string, unknown>>
}

/** Hand-written placeholder values per slug, merged over the ones derived from `inputSchema`. */
export type JobInputExamples = Record<string, Record<string, unknown>>

const relationSample = (relationTo: string | string[]): unknown => {
	if (typeof relationTo === 'string') {
		return `<${relationTo} id>`
	}
	const first = relationTo[0] ?? ''
	return { relationTo: first, value: `<${first} id>` }
}

/** Lists carry one element so the placeholder shows the element's shape. */
const sampleFor = (field: Field): unknown => {
	if ('defaultValue' in field && field.defaultValue !== undefined) {
		if (typeof field.defaultValue !== 'function') return field.defaultValue
	}
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
		case 'blocks': {
			const block = (field.blockReferences ?? field.blocks).find(
				(entry) => typeof entry !== 'string'
			)
			return block ? [{ blockType: block.slug, ...derivePlaceholder(block.fields) }] : []
		}
		case 'group':
			return derivePlaceholder(field.fields)
		default:
			return ''
	}
}

type Entry = [string, unknown]

const entriesOf = (field: Field): Entry[] => {
	if (fieldIsPresentationalOnly(field) || field.type === 'join') return []
	if (field.type === 'tabs') {
		return field.tabs.flatMap((tab): Entry[] =>
			tabHasName(tab) ? [[tab.name, derivePlaceholder(tab.fields)]] : tab.fields.flatMap(entriesOf)
		)
	}
	if (!fieldAffectsData(field)) {
		return 'fields' in field ? field.fields.flatMap(entriesOf) : []
	}
	const sample = sampleFor(field)
	const many = 'hasMany' in field && field.hasMany && !Array.isArray(sample)
	return [[field.name, many ? [sample] : sample]]
}

/** The placeholder object an `inputSchema` describes. */
export const derivePlaceholder = (fields: Field[] = []): Record<string, unknown> =>
	Object.fromEntries(fields.flatMap(entriesOf))

/** Placeholders for every configured task and workflow, with a slug's example merged over the derived object. */
export const collectInputPlaceholders = (
	config: Config,
	examples: JobInputExamples = {}
): JobInputPlaceholders => {
	const from = (entries: { inputSchema?: Field[]; slug: string }[]) =>
		Object.fromEntries(
			entries.map((entry) => [
				entry.slug,
				{ ...derivePlaceholder(entry.inputSchema), ...examples[entry.slug] },
			])
		)
	return {
		tasks: from(config.jobs?.tasks ?? []),
		workflows: from(config.jobs?.workflows ?? []),
	}
}
