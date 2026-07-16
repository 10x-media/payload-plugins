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

/**
 * Project the form's field rows into flow entries. Named rows are keyed and labeled by their
 * trimmed name. Nameless rows of a bare type are keyed by their block row id and labeled with
 * the type's display label (numbered in form order when the type occurs more than once). Rows
 * with neither a usable name nor a bare-type row id are not addressable and are skipped.
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
			entries.push({ key: name, label: name })
			continue
		}
		if (!isBareRow(row)) {
			continue
		}
		const label = bareTypeLabels[row.blockType] ?? row.blockType
		const n = (bareSeen.get(row.blockType) ?? 0) + 1
		bareSeen.set(row.blockType, n)
		entries.push({
			key: String(row.id),
			label: (bareTotals.get(row.blockType) ?? 0) > 1 ? `${label} ${n}` : label,
		})
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
