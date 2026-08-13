import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateFromVotes } from './aggregateFromVotes'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from './votesCollection'

const find = vi.fn()
const payload = { find } as unknown as Payload

const options = [
	{ value: 'red', label: 'Red' },
	{ value: 'blue', label: 'Blue' },
	{ value: 'green', label: 'Green' },
]

const row = (value: string, count: number) => ({ form: 'f1', field: 'color', value, count })

describe('aggregateFromVotes', () => {
	beforeEach(() => {
		find.mockReset()
		find.mockResolvedValue({ docs: [] })
	})

	it('pins the find call shape: one query over the form + field rows, access overridden, req threaded', async () => {
		const req = { transactionID: 't1' } as unknown as PayloadRequest
		await aggregateFromVotes({ payload, formId: 7, field: 'color', options, req })
		expect(find).toHaveBeenCalledOnce()
		expect(find).toHaveBeenCalledWith({
			collection: POLL_VOTES_SLUG,
			where: { and: [{ form: { equals: '7' } }, { field: { equals: 'color' } }] },
			limit: 100_000,
			pagination: false,
			depth: 0,
			overrideAccess: true,
			req,
		})
	})

	it('zero-seeds buckets from the options in order and fills counts + percentages from the rows', async () => {
		find.mockResolvedValue({
			docs: [row('blue', 1), row('red', 3), row(RESPONDENTS_VALUE, 4)],
		})
		const result = await aggregateFromVotes({
			payload,
			formId: 'f1',
			field: 'color',
			meta: { label: 'Color', fieldType: 'radio' },
			options,
		})
		expect(result).toEqual({
			field: 'color',
			label: 'Color',
			fieldType: 'radio',
			total: 4,
			buckets: [
				{ value: 'red', label: 'Red', count: 3, percentage: 75 },
				{ value: 'blue', label: 'Blue', count: 1, percentage: 25 },
				{ value: 'green', label: 'Green', count: 0, percentage: 0 },
			],
			truncated: false,
		})
	})

	it('appends unknown tally values after the options, count-descending, labeled by raw value', async () => {
		find.mockResolvedValue({
			docs: [row('legacy-a', 1), row('red', 5), row('legacy-b', 2), row(RESPONDENTS_VALUE, 8)],
		})
		const result = await aggregateFromVotes({ payload, formId: 'f1', field: 'color', options })
		expect(result.buckets.map((bucket) => bucket.value)).toEqual([
			'red',
			'blue',
			'green',
			'legacy-b',
			'legacy-a',
		])
		expect(result.buckets[3]).toEqual({
			value: 'legacy-b',
			label: 'legacy-b',
			count: 2,
			percentage: 25,
		})
	})

	it('serves an empty store as total 0 with zeroed buckets and 0 percentages', async () => {
		const result = await aggregateFromVotes({ payload, formId: 'f1', field: 'color', options })
		expect(result.total).toBe(0)
		expect(result.buckets).toEqual(
			options.map(({ value, label }) => ({ value, label, count: 0, percentage: 0 }))
		)
	})

	it('denominates percentages by the respondents row, not the summed counts (multi-value answers)', async () => {
		find.mockResolvedValue({
			docs: [row('red', 5), row('blue', 4), row(RESPONDENTS_VALUE, 7)],
		})
		const result = await aggregateFromVotes({ payload, formId: 'f1', field: 'color', options })
		expect(result.total).toBe(7)
		expect(result.buckets[0]?.percentage).toBe(71.4)
		expect(result.buckets[1]?.percentage).toBe(57.1)
	})

	it('sums counts across shard rows for the same value and for respondents', async () => {
		find.mockResolvedValue({
			docs: [
				row('red', 2),
				row('red', 3),
				row('blue', 1),
				row(RESPONDENTS_VALUE, 4),
				row(RESPONDENTS_VALUE, 2),
			],
		})
		const result = await aggregateFromVotes({ payload, formId: 'f1', field: 'color', options })
		expect(result.total).toBe(6)
		expect(result.buckets[0]).toMatchObject({ value: 'red', count: 5 })
		expect(result.buckets[1]).toMatchObject({ value: 'blue', count: 1 })
	})

	it('is never truncated', async () => {
		find.mockResolvedValue({ docs: [row('red', 99999), row(RESPONDENTS_VALUE, 99999)] })
		const result = await aggregateFromVotes({ payload, formId: 'f1', field: 'color', options })
		expect(result.truncated).toBe(false)
	})

	it('clamps a drift-negative value sum and total to zero', async () => {
		// A concurrent double-change can double-decrement one value across shard rows; the reader
		// must never surface a negative count.
		find.mockResolvedValue({
			docs: [
				row('red', 1),
				row('red', -2),
				row('blue', 2),
				row(RESPONDENTS_VALUE, 2),
				row(RESPONDENTS_VALUE, -3),
			],
		})
		const result = await aggregateFromVotes({ payload, formId: 'f1', field: 'color', options })
		expect(result.total).toBe(0)
		expect(result.buckets.map((bucket) => [bucket.value, bucket.count])).toEqual([
			['red', 0],
			['blue', 2],
			['green', 0],
		])
	})
})
