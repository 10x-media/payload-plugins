import type { FlowStep } from '../flow/types'

/**
 * Display label for a step: its trimmed title, else the fallback template with
 * `{n}` replaced by the 1-based index. Step ids never surface in the UI.
 */
export const stepLabel = (
	step: Pick<FlowStep, 'title'>,
	index: number,
	fallbackTemplate: string
): string => {
	const title = step.title?.trim()
	return title !== undefined && title.length > 0
		? title
		: fallbackTemplate.replace('{n}', String(index + 1))
}

/** Field name to index of the step holding it (first occurrence wins). */
export const fieldHolders = (steps: Pick<FlowStep, 'fields'>[]): Map<string, number> => {
	const holders = new Map<string, number>()
	steps.forEach((step, index) => {
		for (const field of step.fields) {
			if (!holders.has(field)) holders.set(field, index)
		}
	})
	return holders
}

/** Form fields not assigned to any step, in form order. */
export const unassignedFields = (
	fieldNames: string[],
	steps: Pick<FlowStep, 'fields'>[]
): string[] => {
	const assigned = new Set(steps.flatMap((step) => step.fields))
	return fieldNames.filter((name) => !assigned.has(name))
}

/** Assign a field to the step at `targetIndex`, stripping it from every other step. */
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

/** Remove a field from the step at `targetIndex`, leaving other steps untouched. */
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
