import type { Payload, PayloadRequest } from 'payload'
import type { FieldAggregation } from '../../aggregation/types'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from './votesCollection'

type VoteRow = { field?: unknown; value?: unknown; count?: unknown }

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Poll results from the tally store: one find over the form's rows for the field (O(options),
 * no scan, no truncation), buckets zero-seeded from the effective options so order and labels
 * match the scan-based shape. Counts sum across shard rows (see VOTE_SHARDS). `total` comes
 * from the respondents rows, keeping the percentage denominator exact for multi-value answers.
 */
export const aggregateFromVotes = async (args: {
	payload: Payload
	formId: number | string
	field: string
	meta?: { label?: string; fieldType?: string }
	options: { value: string; label: string }[]
	req?: PayloadRequest
}): Promise<FieldAggregation> => {
	const { payload, formId, field, meta, options, req } = args
	const { docs } = await payload.find({
		collection: POLL_VOTES_SLUG,
		where: { and: [{ form: { equals: String(formId) } }, { field: { equals: field } }] },
		limit: 100_000,
		pagination: false,
		depth: 0,
		overrideAccess: true,
		req,
	})

	const counts = new Map<string, number>()
	let total = 0
	for (const doc of docs as VoteRow[]) {
		const value = doc.value == null ? RESPONDENTS_VALUE : String(doc.value)
		const count = typeof doc.count === 'number' ? doc.count : 0
		if (value === RESPONDENTS_VALUE) {
			total += count
		} else {
			counts.set(value, (counts.get(value) ?? 0) + count)
		}
	}

	const optionValues = new Set(options.map((option) => option.value))
	const leftovers = [...counts.keys()]
		.filter((value) => !optionValues.has(value))
		.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
	const labelByValue = new Map(options.map((option) => [option.value, option.label]))

	const buckets = [...options.map((option) => option.value), ...leftovers].map((value) => {
		const count = counts.get(value) ?? 0
		return {
			value,
			label: labelByValue.get(value) ?? value,
			count,
			percentage: total > 0 ? round1((count / total) * 100) : 0,
		}
	})

	return {
		field,
		label: meta?.label,
		fieldType: meta?.fieldType,
		total,
		buckets,
		truncated: false,
	}
}
