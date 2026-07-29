import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { aggregateFormResponses, aggregateFromVotes, resolveEffectivePollOptions } = vi.hoisted(
	() => ({
		aggregateFormResponses: vi.fn(),
		aggregateFromVotes: vi.fn(),
		resolveEffectivePollOptions: vi.fn(),
	})
)
vi.mock('./aggregateResponses', async (importOriginal) => ({
	...(await importOriginal<typeof import('./aggregateResponses')>()),
	aggregateFormResponses,
}))
vi.mock('../poll/votes/aggregateFromVotes', () => ({ aggregateFromVotes }))
vi.mock('../poll/effectivePollOptions', () => ({ resolveEffectivePollOptions }))

const { resolveFormResultsRequest } = await import('./resolveResultsRequest')

const options = [
	{ value: 'red', label: 'Red' },
	{ value: 'blue', label: 'Blue' },
]

const pollForm = {
	id: 'f1',
	pollEnabled: true,
	poll: { resultsField: 'color', resultsVisibility: 'afterVote' },
	fields: [{ blockType: 'radio', name: 'color', label: 'Color', options }],
}

const findByID = vi.fn()
const payload = { findByID } as unknown as Payload

const tallyAggregation = {
	field: 'color',
	label: 'Color',
	fieldType: 'radio',
	total: 4,
	buckets: [],
	truncated: false,
}

describe('resolveFormResultsRequest tally switch', () => {
	beforeEach(() => {
		findByID.mockReset()
		aggregateFormResponses.mockReset()
		aggregateFromVotes.mockReset()
		resolveEffectivePollOptions.mockReset()
		findByID.mockResolvedValue(pollForm)
		aggregateFormResponses.mockResolvedValue([{ field: 'color', total: 1, buckets: [] }])
		aggregateFromVotes.mockResolvedValue(tallyAggregation)
		resolveEffectivePollOptions.mockResolvedValue(options)
	})

	it('serves the anonymous poll read from the tally store when pollVotesEnabled', async () => {
		const result = await resolveFormResultsRequest({
			payload,
			formId: 'f1',
			isAuthed: false,
			pollVotesEnabled: true,
		})
		expect(result.status).toBe(200)
		expect(result.body).toEqual({ results: [tallyAggregation] })
		expect(aggregateFromVotes).toHaveBeenCalledWith({
			payload,
			formId: 'f1',
			field: 'color',
			meta: { label: 'Color', fieldType: 'radio' },
			options,
			req: undefined,
		})
		expect(aggregateFormResponses).not.toHaveBeenCalled()
	})

	it('keeps the anonymous poll read on the submission scan when the store is disabled', async () => {
		const result = await resolveFormResultsRequest({ payload, formId: 'f1', isAuthed: false })
		expect(result.status).toBe(200)
		expect(aggregateFromVotes).not.toHaveBeenCalled()
		expect(aggregateFormResponses).toHaveBeenCalledOnce()
	})

	it('keeps every anonymous gate: a non-poll form stays 403 with the store enabled', async () => {
		findByID.mockResolvedValue({ ...pollForm, pollEnabled: false })
		const result = await resolveFormResultsRequest({
			payload,
			formId: 'f1',
			isAuthed: false,
			pollVotesEnabled: true,
		})
		expect(result.status).toBe(403)
		expect(aggregateFromVotes).not.toHaveBeenCalled()
	})

	it('fails closed when the anonymous option resolve fails, tallies or not', async () => {
		resolveEffectivePollOptions.mockRejectedValue(new Error('source down'))
		const result = await resolveFormResultsRequest({
			payload,
			formId: 'f1',
			isAuthed: false,
			pollVotesEnabled: true,
		})
		expect(result.status).toBe(503)
		expect(aggregateFromVotes).not.toHaveBeenCalled()
	})

	it('serves an authed explicit poll-field read from the tally store when pollVotesEnabled', async () => {
		const result = await resolveFormResultsRequest({
			payload,
			formId: 'f1',
			field: 'color',
			isAuthed: true,
			pollVotesEnabled: true,
		})
		expect(result.status).toBe(200)
		expect(result.body).toEqual({ results: [tallyAggregation] })
		expect(aggregateFromVotes).toHaveBeenCalledWith({
			payload,
			formId: 'f1',
			field: 'color',
			meta: { label: 'Color', fieldType: 'radio' },
			options,
			req: undefined,
		})
		expect(aggregateFormResponses).not.toHaveBeenCalled()
	})

	it('keeps the authed all-fields read on the scan even with the store enabled', async () => {
		await resolveFormResultsRequest({
			payload,
			formId: 'f1',
			isAuthed: true,
			pollVotesEnabled: true,
		})
		expect(aggregateFromVotes).not.toHaveBeenCalled()
		expect(aggregateFormResponses).toHaveBeenCalledOnce()
	})

	it('keeps an authed read of a non-poll field on the scan', async () => {
		await resolveFormResultsRequest({
			payload,
			formId: 'f1',
			field: 'topic',
			isAuthed: true,
			pollVotesEnabled: true,
		})
		expect(aggregateFromVotes).not.toHaveBeenCalled()
		expect(aggregateFormResponses).toHaveBeenCalledWith(
			expect.objectContaining({ fields: ['topic'] })
		)
	})

	it('keeps the authed explicit poll-field read on the scan when the store is disabled', async () => {
		await resolveFormResultsRequest({ payload, formId: 'f1', field: 'color', isAuthed: true })
		expect(aggregateFromVotes).not.toHaveBeenCalled()
		expect(aggregateFormResponses).toHaveBeenCalledOnce()
	})
})
