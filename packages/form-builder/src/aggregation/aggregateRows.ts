import type { AggregationBucket, AggregationRow, FieldAggregation, FieldMeta } from './types'

const round1 = (n: number): number => Math.round(n * 10) / 10

/** The grouping keys a single answer contributes: [] for empty, one per element for arrays, else one. */
const valueKeys = (value: unknown): string[] => {
	if (value == null || value === '') {
		return []
	}
	if (Array.isArray(value)) {
		return value.filter((entry) => entry != null && entry !== '').map((entry) => String(entry))
	}
	return [String(value)]
}

/** Merge every row's descriptor snapshot for one field into a value -> label map (last write wins). */
const snapshotLabels = (rows: AggregationRow[], field: string): Map<string, string> => {
	const labels = new Map<string, string>()
	for (const row of rows) {
		for (const descriptor of row.descriptors ?? []) {
			if (descriptor.field === field && descriptor.optionLabels) {
				for (const [value, label] of Object.entries(descriptor.optionLabels)) {
					labels.set(value, label)
				}
			}
		}
	}
	return labels
}

/** Aggregate one field across rows: respondent-denominated counts + percentages, option-ordered. */
export const aggregateRowForField = (
	rows: AggregationRow[],
	meta: FieldMeta,
	truncated: boolean
): FieldAggregation => {
	const counts = new Map<string, number>()
	const order: string[] = []
	for (const option of meta.options ?? []) {
		counts.set(option.value, 0)
		order.push(option.value)
	}
	const snapshots = snapshotLabels(rows, meta.field)
	let total = 0
	for (const row of rows) {
		const answer = (row.values ?? []).find((entry) => entry.field === meta.field)
		const keys = valueKeys(answer?.value)
		if (keys.length === 0) {
			continue
		}
		total += 1
		for (const key of keys) {
			if (!counts.has(key)) {
				counts.set(key, 0)
				order.push(key)
			}
			counts.set(key, (counts.get(key) ?? 0) + 1)
		}
	}

	const optionValues = new Set((meta.options ?? []).map((option) => option.value))
	const leftovers = order
		.filter((value) => !optionValues.has(value))
		.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
	const ordered = [...(meta.options ?? []).map((option) => option.value), ...leftovers]

	const optionLabelByValue = new Map(
		(meta.options ?? []).map((option) => [option.value, option.label])
	)
	const buckets: AggregationBucket[] = ordered.map((value) => {
		const count = counts.get(value) ?? 0
		return {
			value,
			label: optionLabelByValue.get(value) ?? snapshots.get(value) ?? value,
			count,
			percentage: total > 0 ? round1((count / total) * 100) : 0,
		}
	})

	return {
		field: meta.field,
		label: meta.label,
		fieldType: meta.fieldType,
		total,
		buckets,
		truncated,
	}
}

/** Aggregate several fields across the same set of rows. */
export const aggregateRowsForFields = (
	rows: AggregationRow[],
	metas: FieldMeta[],
	truncated: boolean
): FieldAggregation[] => metas.map((meta) => aggregateRowForField(rows, meta, truncated))
