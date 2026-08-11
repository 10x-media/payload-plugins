import type { SubmissionValue } from '../../submissions/types'

/**
 * A submission's answer(s) for one field as normalized non-empty strings: the shape both the vote
 * tally and the voted-pick resolver count by (a multi-select answer contributes one entry per
 * selected value).
 */
export const answerValues = (values: unknown, field: string): string[] => {
	if (!Array.isArray(values)) return []
	const entry = (values as SubmissionValue[]).find((row) => row.field === field)
	if (entry == null) return []
	const raw = Array.isArray(entry.value) ? entry.value : [entry.value]
	return raw.filter((value) => value != null && value !== '').map((value) => String(value))
}
