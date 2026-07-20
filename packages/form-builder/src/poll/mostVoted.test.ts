import { describe, expect, it } from 'vitest'
import type { AggregationBucket, FieldAggregation } from '../aggregation/types'
import { mostVotedStrategy, topBucketValues } from './mostVoted'

const bucket = (value: string, count: number): AggregationBucket => ({
	value,
	label: value,
	count,
	percentage: 0,
})

const aggregation = (over: Partial<FieldAggregation>): FieldAggregation => ({
	field: 'winner',
	total: 0,
	buckets: [],
	truncated: false,
	...over,
})

describe('topBucketValues', () => {
	it('returns the single value with the highest count', () => {
		expect(topBucketValues([bucket('ada', 5), bucket('grace', 3)])).toEqual(['ada'])
	})

	it('returns every value tied for the highest count', () => {
		expect(topBucketValues([bucket('ada', 3), bucket('grace', 3), bucket('lin', 1)])).toEqual([
			'ada',
			'grace',
		])
	})

	it('returns an empty set for no buckets', () => {
		expect(topBucketValues([])).toEqual([])
	})
})

describe('mostVotedStrategy.resolveOutcome', () => {
	const run = (agg: FieldAggregation | null) =>
		mostVotedStrategy.resolveOutcome({
			payload: {} as never,
			form: { id: 1 },
			poll: {},
			aggregate: () => Promise.resolve(agg),
		})

	it('returns undefined when the aggregation is null', async () => {
		expect(await run(null)).toBeUndefined()
	})

	it('returns undefined when there are no responses yet', async () => {
		expect(await run(aggregation({ total: 0, buckets: [bucket('ada', 0)] }))).toBeUndefined()
	})

	it('refuses to auto-decide on a truncated (sampled) aggregation', async () => {
		expect(
			await run(aggregation({ total: 9, truncated: true, buckets: [bucket('ada', 9)] }))
		).toBeUndefined()
	})

	it('returns the top value on a settled aggregation', async () => {
		expect(
			await run(aggregation({ total: 8, buckets: [bucket('ada', 5), bucket('grace', 3)] }))
		).toEqual(['ada'])
	})

	it('returns both values on a tie', async () => {
		expect(
			await run(aggregation({ total: 6, buckets: [bucket('ada', 3), bucket('grace', 3)] }))
		).toEqual(['ada', 'grace'])
	})
})
