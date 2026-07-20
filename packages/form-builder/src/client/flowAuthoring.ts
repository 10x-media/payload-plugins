import { END_OF_FORM, type FlowStep } from '../flow/types'
import type { FieldRow } from './synthesizeClientField'

export { stepLabel } from '../flow/stepLabel'
export { END_OF_FORM }

/** Project a step's stored `next` onto its select option value ('' = sequential fall-through). */
export const nextToSelectValue = (next: FlowStep['next']): string =>
	next === null ? END_OF_FORM : (next ?? '')

/** Parse a select option value back into a stored `next` (undefined = sequential fall-through). */
export const nextFromSelectValue = (value: string): FlowStep['next'] =>
	value === END_OF_FORM ? null : value.length > 0 ? value : undefined

/** A form field as the flow builder addresses it: its stable key plus a display label. */
export type FlowFieldEntry = { key: string; label: string }

/** A flow builder select option. Structurally a `ReactSelectOption`, without the client-only import. */
export type FlowSelectOption = { label: string; value: string }

/**
 * One option per step, labeled like its step card. A step whose id is empty is dropped: the id is
 * the option's value, so such a step cannot be routed to and an empty value would collide with the
 * next select's sequential option.
 */
export const stepSelectOptions = (
	steps: Pick<FlowStep, 'id'>[],
	labels: string[]
): FlowSelectOption[] =>
	steps
		.map((step, index) => ({ label: labels[index] ?? '', value: step.id }))
		.filter((option) => option.value.length > 0)

/** Every step but `stepId`, so a step's own next/transition selects cannot route it to itself. */
export const otherStepSelectOptions = (
	options: FlowSelectOption[],
	stepId: string
): FlowSelectOption[] => options.filter((option) => option.value !== stepId)

/**
 * The `next` select's options: sequential fall-through first (the default, and what an absent
 * `next` maps to), then explicit end of form, then every other step. Values round-trip through
 * `nextFromSelectValue`.
 */
export const nextSelectOptions = (args: {
	sequentialLabel: string
	terminalLabel: string
	otherSteps: FlowSelectOption[]
}): FlowSelectOption[] => [
	{ label: args.sequentialLabel, value: '' },
	{ label: args.terminalLabel, value: END_OF_FORM },
	...args.otherSteps,
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value != null && typeof value === 'object' && !Array.isArray(value)

/** Chars kept before truncating a `messageSnippet` result, plus a trailing ellipsis. */
const MESSAGE_SNIPPET_LENGTH = 40

/**
 * Short plain-text preview of a bare message block's richText content, for the flow step list.
 * Reads only the shallow lexical shape (`root.children[].children[].text`), which is all a short
 * authored message needs; a legacy Slate body or other non-lexical shape yields `undefined`, same
 * as empty content, so the caller falls back to the block type's display label.
 */
export const messageSnippet = (content: unknown): string | undefined => {
	const root = isRecord(content) ? content.root : undefined
	const blockNodes = isRecord(root) && Array.isArray(root.children) ? root.children : []
	const text = blockNodes
		.map((block) => {
			const leaves = isRecord(block) && Array.isArray(block.children) ? block.children : []
			return leaves
				.map((leaf) => (isRecord(leaf) && typeof leaf.text === 'string' ? leaf.text : ''))
				.join('')
		})
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim()
	if (text.length === 0) {
		return undefined
	}
	return text.length > MESSAGE_SNIPPET_LENGTH
		? `${text.slice(0, MESSAGE_SNIPPET_LENGTH).trimEnd()}…`
		: text
}

/**
 * Project the form's field rows into flow entries. Named rows are keyed by their trimmed name and
 * labeled with their configured `label`, falling back to the name when unset. Nameless rows of a
 * bare type are keyed by their block row id and labeled with a snippet of their content when they
 * have any (see `messageSnippet`), else the type's display label (numbered in form order when the
 * type occurs more than once). Rows with neither a usable name nor a bare-type row id are not
 * addressable and are skipped.
 */
export const flowFieldEntries = (
	rows: FieldRow[],
	bareTypeLabels: Record<string, string>
): FlowFieldEntry[] => {
	const isBareRow = (row: FieldRow): boolean =>
		bareTypeLabels[row.blockType] !== undefined && row.id != null
	const nameOf = (row: FieldRow): string => (typeof row.name === 'string' ? row.name.trim() : '')

	const bareTotals = new Map<string, number>()
	for (const row of rows) {
		if (nameOf(row).length === 0 && isBareRow(row)) {
			bareTotals.set(row.blockType, (bareTotals.get(row.blockType) ?? 0) + 1)
		}
	}

	const bareSeen = new Map<string, number>()
	const entries: FlowFieldEntry[] = []
	for (const row of rows) {
		const name = nameOf(row)
		if (name.length > 0) {
			const label = typeof row.label === 'string' && row.label.trim().length > 0 ? row.label : name
			entries.push({ key: name, label })
			continue
		}
		if (!isBareRow(row)) {
			continue
		}
		const typeLabel = bareTypeLabels[row.blockType] ?? row.blockType
		const n = (bareSeen.get(row.blockType) ?? 0) + 1
		bareSeen.set(row.blockType, n)
		const fallback = (bareTotals.get(row.blockType) ?? 0) > 1 ? `${typeLabel} ${n}` : typeLabel
		entries.push({ key: String(row.id), label: messageSnippet(row.content) ?? fallback })
	}
	return entries
}

/** Field key to index of the step holding it (first occurrence wins). */
export const fieldHolders = (steps: Pick<FlowStep, 'fields'>[]): Map<string, number> => {
	const holders = new Map<string, number>()
	steps.forEach((step, index) => {
		for (const field of step.fields) {
			if (!holders.has(field)) holders.set(field, index)
		}
	})
	return holders
}

/** Entries not assigned to any step, in form order. */
export const unassignedEntries = (
	entries: FlowFieldEntry[],
	steps: Pick<FlowStep, 'fields'>[]
): FlowFieldEntry[] => {
	const assigned = new Set(steps.flatMap((step) => step.fields))
	return entries.filter((entry) => !assigned.has(entry.key))
}

/** Assign a field key to the step at `targetIndex`, stripping it from every other step. */
export const assignFieldToStep = (
	steps: FlowStep[],
	targetIndex: number,
	field: string
): FlowStep[] =>
	steps.map((step, index) => {
		if (index === targetIndex) {
			return step.fields.includes(field) ? step : { ...step, fields: [...step.fields, field] }
		}
		return step.fields.includes(field)
			? { ...step, fields: step.fields.filter((f) => f !== field) }
			: step
	})

/** Remove a field key from the step at `targetIndex`, leaving other steps untouched. */
export const removeFieldFromStep = (
	steps: FlowStep[],
	targetIndex: number,
	field: string
): FlowStep[] =>
	steps.map((step, index) =>
		index === targetIndex && step.fields.includes(field)
			? { ...step, fields: step.fields.filter((f) => f !== field) }
			: step
	)

/**
 * Remove the step at `index` and every reference to it: another step's `next` pointing at it
 * returns to absent (sequential fall-through), and transitions targeting it are dropped. Without
 * the cascade a dangling `next` would silently route into whatever step follows it in the array.
 */
export const removeStepCascade = (steps: FlowStep[], index: number): FlowStep[] => {
	const removed = steps[index]
	const rest = steps.filter((_, i) => i !== index)
	if (!removed) {
		return rest
	}
	return rest.map((step) => {
		const keptTransitions = (step.transitions ?? []).filter((t) => t.to !== removed.id)
		const dropsNext = step.next === removed.id
		const dropsTransitions = keptTransitions.length !== (step.transitions?.length ?? 0)
		if (!dropsNext && !dropsTransitions) {
			return step
		}
		const { next, transitions, ...base } = step
		const cleaned: FlowStep = { ...base }
		if (!dropsNext && next !== undefined) cleaned.next = next
		if (keptTransitions.length > 0) cleaned.transitions = keptTransitions
		return cleaned
	})
}
