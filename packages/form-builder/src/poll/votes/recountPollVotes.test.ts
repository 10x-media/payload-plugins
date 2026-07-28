import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from './votesCollection'

const { bumpPollVote, aggregateFieldResponses } = vi.hoisted(() => ({
	bumpPollVote: vi.fn(),
	aggregateFieldResponses: vi.fn(),
}))
vi.mock('./bumpPollVote', () => ({ bumpPollVote }))
vi.mock('../../aggregation/aggregateResponses', () => ({ aggregateFieldResponses }))

const { recountPollVotes } = await import('./recountPollVotes')

const findByID = vi.fn()
const deleteMock = vi.fn()
const payload = { findByID, delete: deleteMock } as unknown as Payload

const aggregation = (total: number, buckets: { value: string; count: number }[]) => ({
	field: 'color',
	total,
	buckets: buckets.map((bucket) => ({ ...bucket, label: bucket.value, percentage: 0 })),
	truncated: false,
})

describe('recountPollVotes', () => {
	beforeEach(() => {
		findByID.mockReset()
		deleteMock.mockReset()
		bumpPollVote.mockReset()
		aggregateFieldResponses.mockReset()
		findByID.mockResolvedValue({ id: 'f1', pollEnabled: true, poll: { resultsField: 'color' } })
		deleteMock.mockResolvedValue({})
		bumpPollVote.mockResolvedValue(undefined)
		aggregateFieldResponses.mockResolvedValue(
			aggregation(4, [
				{ value: 'red', count: 3 },
				{ value: 'blue', count: 1 },
				{ value: 'green', count: 0 },
			])
		)
	})

	it('deletes the field tally rows, then replays the scan into fresh bumps plus the respondents row', async () => {
		const calls: string[] = []
		deleteMock.mockImplementation(async () => calls.push('delete'))
		aggregateFieldResponses.mockImplementation(async () => {
			calls.push('aggregate')
			return aggregation(4, [
				{ value: 'red', count: 3 },
				{ value: 'blue', count: 1 },
				{ value: 'green', count: 0 },
			])
		})
		bumpPollVote.mockImplementation(async (_payload, key: { value: string }) =>
			calls.push(`bump:${key.value}`)
		)

		await recountPollVotes({ payload, formId: 'f1' })

		expect(calls).toEqual([
			'delete',
			'aggregate',
			'bump:red',
			'bump:blue',
			`bump:${RESPONDENTS_VALUE}`,
		])
		expect(deleteMock).toHaveBeenCalledWith({
			collection: POLL_VOTES_SLUG,
			where: { and: [{ form: { equals: 'f1' } }, { field: { equals: 'color' } }] },
			overrideAccess: true,
			req: undefined,
		})
		expect(aggregateFieldResponses).toHaveBeenCalledWith({
			payload,
			formId: 'f1',
			field: 'color',
			req: undefined,
			maxSubmissions: 100_000,
		})
		expect(bumpPollVote).toHaveBeenCalledWith(
			payload,
			{ form: 'f1', field: 'color', value: 'red' },
			3
		)
		expect(bumpPollVote).toHaveBeenCalledWith(
			payload,
			{ form: 'f1', field: 'color', value: RESPONDENTS_VALUE },
			4
		)
	})

	it('skips zero-count buckets so the rebuilt store carries no dead rows', async () => {
		await recountPollVotes({ payload, formId: 'f1' })
		const values = bumpPollVote.mock.calls.map((call) => (call[1] as { value: string }).value)
		expect(values).not.toContain('green')
	})

	it('returns early without touching the store when the form has no results field', async () => {
		findByID.mockResolvedValue({ id: 'f1', pollEnabled: true, poll: {} })
		await recountPollVotes({ payload, formId: 'f1' })
		expect(deleteMock).not.toHaveBeenCalled()
		expect(aggregateFieldResponses).not.toHaveBeenCalled()
		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('returns early when the form does not exist', async () => {
		findByID.mockRejectedValue(new Error('missing'))
		await recountPollVotes({ payload, formId: 'ghost' })
		expect(deleteMock).not.toHaveBeenCalled()
		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('leaves the store empty after the delete when the aggregation is null or empty', async () => {
		aggregateFieldResponses.mockResolvedValue(null)
		await recountPollVotes({ payload, formId: 'f1' })
		expect(deleteMock).toHaveBeenCalledOnce()
		expect(bumpPollVote).not.toHaveBeenCalled()

		aggregateFieldResponses.mockResolvedValue(aggregation(0, []))
		await recountPollVotes({ payload, formId: 'f1' })
		expect(bumpPollVote).not.toHaveBeenCalled()
	})
})
