import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { definePollOptionSource } from './definePollOptionSource'
import { resolvePollTypes, stashPollTypes } from './pollTypeRegistry'
import type { PollOptionSourceRegistry } from './registry'
import { stashPollOptionSources } from './resolvePollOptions'

const { aggregateFieldResponses, aggregateFromVotes, resolveEffectivePollOptions } = vi.hoisted(
	() => ({
		aggregateFieldResponses: vi.fn(),
		aggregateFromVotes: vi.fn(),
		resolveEffectivePollOptions: vi.fn(),
	})
)
vi.mock('../aggregation/aggregateResponses', () => ({ aggregateFieldResponses }))
vi.mock('./votes/aggregateFromVotes', () => ({ aggregateFromVotes }))
vi.mock('./effectivePollOptions', () => ({ resolveEffectivePollOptions }))

const { resolvePollOutcome } = await import('./resolvePollOutcome')

const sources: PollOptionSourceRegistry = new Map([
	[
		'athletes',
		definePollOptionSource<{ winner?: string }>({
			type: 'athletes',
			label: 'Athletes',
			resolve: () => [{ label: 'Ada', value: 'ada' }],
			resolveOutcome: ({ config }) => config.winner,
		}),
	],
	[
		'tie',
		definePollOptionSource({
			type: 'tie',
			label: 'Tie',
			resolve: () => [
				{ label: 'Ada', value: 'ada' },
				{ label: 'Grace', value: 'grace' },
			],
			resolveOutcome: () => ['ada', 'grace'],
		}),
	],
	[
		'plain',
		definePollOptionSource({
			type: 'plain',
			label: 'Plain',
			resolve: () => [],
		}),
	],
])

const payloadWith = (poll: unknown, pollEnabled = true) => {
	const findByID = vi.fn().mockResolvedValue({ id: 1, title: 'Race', pollEnabled, poll })
	const update = vi.fn().mockResolvedValue({})
	const custom = stashPollTypes(stashPollOptionSources(undefined, sources), resolvePollTypes())
	const payload = { findByID, update, config: { custom } } as unknown as Payload
	return { payload, findByID, update }
}

describe('resolvePollOutcome', () => {
	it('writes an explicit outcome with overrideAccess and leaves stamping to the hook', async () => {
		const { payload, update } = payloadWith({ resultsField: 'winner' })
		const recorded = await resolvePollOutcome({ payload, formId: 1, winningValues: ['ada'] })
		expect(recorded).toEqual(['ada'])
		expect(update).toHaveBeenCalledOnce()
		const args = update.mock.calls[0]?.[0] as {
			collection: string
			id: number
			overrideAccess: boolean
			data: { poll: { outcome: Record<string, unknown> } }
		}
		expect(args.collection).toBe('forms')
		expect(args.id).toBe(1)
		expect(args.overrideAccess).toBe(true)
		expect(args.data.poll.outcome).toEqual({ winningValues: ['ada'] })
	})

	it('writes an explicit tie of several winners', async () => {
		const { payload, update } = payloadWith({ resultsField: 'winner' })
		const recorded = await resolvePollOutcome({
			payload,
			formId: 1,
			winningValues: ['ada', 'grace'],
		})
		expect(recorded).toEqual(['ada', 'grace'])
		const args = update.mock.calls[0]?.[0] as { data: { poll: { outcome: unknown } } }
		expect(args.data.poll.outcome).toEqual({ winningValues: ['ada', 'grace'] })
	})

	it('resolves a single winner via the source strategy when winningValues is omitted', async () => {
		const { payload, update } = payloadWith({
			type: 'source',
			optionSource: 'athletes',
			sourceConfig: { winner: 'ada' },
		})
		const recorded = await resolvePollOutcome({ payload, formId: 1 })
		expect(recorded).toEqual(['ada'])
		const args = update.mock.calls[0]?.[0] as { data: { poll: { outcome: unknown } } }
		expect(args.data.poll.outcome).toEqual({ winningValues: ['ada'] })
	})

	it('resolves a tie via the source strategy returning an array', async () => {
		const { payload, update } = payloadWith({ type: 'source', optionSource: 'tie' })
		const recorded = await resolvePollOutcome({ payload, formId: 1 })
		expect(recorded).toEqual(['ada', 'grace'])
		const args = update.mock.calls[0]?.[0] as { data: { poll: { outcome: unknown } } }
		expect(args.data.poll.outcome).toEqual({ winningValues: ['ada', 'grace'] })
	})

	it('never auto-resolves under the default manual strategy', async () => {
		const { payload, update } = payloadWith({
			optionSource: 'athletes',
			sourceConfig: { winner: 'ada' },
		})
		const recorded = await resolvePollOutcome({ payload, formId: 1 })
		expect(recorded).toEqual([])
		expect(update).not.toHaveBeenCalled()
	})

	it('writes nothing under an unknown strategy type', async () => {
		const { payload, update } = payloadWith({ type: 'nope', optionSource: 'athletes' })
		expect(await resolvePollOutcome({ payload, formId: 1 })).toEqual([])
		expect(update).not.toHaveBeenCalled()
	})

	it('source strategy writes nothing when undecidable or misconfigured', async () => {
		for (const poll of [
			{ type: 'source' },
			{ type: 'source', optionSource: 'ghost' },
			{ type: 'source', optionSource: 'plain' },
			{ type: 'source', optionSource: 'athletes', sourceConfig: {} },
		]) {
			const { payload, update } = payloadWith(poll)
			expect(await resolvePollOutcome({ payload, formId: 1 })).toEqual([])
			expect(update).not.toHaveBeenCalled()
		}
	})

	it('rejects a form that is not poll-enabled', async () => {
		const { payload, update } = payloadWith({ resultsField: 'winner' }, false)
		await expect(
			resolvePollOutcome({ payload, formId: 1, winningValues: ['ada'] })
		).rejects.toThrow(/not poll-enabled/)
		expect(update).not.toHaveBeenCalled()
	})

	it('rejects a form without a poll group', async () => {
		const { payload, update } = payloadWith(null)
		await expect(
			resolvePollOutcome({ payload, formId: 1, winningValues: ['ada'] })
		).rejects.toThrow(/not poll-enabled/)
		expect(update).not.toHaveBeenCalled()
	})
})

describe('resolvePollOutcome tally switch (mostVoted)', () => {
	const votesAggregation = {
		field: 'winner',
		total: 4,
		buckets: [
			{ value: 'ada', label: 'Ada', count: 3, percentage: 75 },
			{ value: 'grace', label: 'Grace', count: 1, percentage: 25 },
		],
		truncated: false,
	}

	beforeEach(() => {
		aggregateFieldResponses.mockReset()
		aggregateFromVotes.mockReset()
		resolveEffectivePollOptions.mockReset()
		aggregateFieldResponses.mockResolvedValue(votesAggregation)
		aggregateFromVotes.mockResolvedValue(votesAggregation)
		resolveEffectivePollOptions.mockResolvedValue([{ value: 'ada', label: 'Ada' }])
	})

	it('aggregates from the tally store when pollVotesEnabled, with the effective options', async () => {
		const { payload, update } = payloadWith({ type: 'mostVoted', resultsField: 'winner' })
		const recorded = await resolvePollOutcome({ payload, formId: 1, pollVotesEnabled: true })
		expect(recorded).toEqual(['ada'])
		expect(aggregateFromVotes).toHaveBeenCalledWith({
			payload,
			formId: 1,
			field: 'winner',
			options: [{ value: 'ada', label: 'Ada' }],
			req: undefined,
		})
		expect(aggregateFieldResponses).not.toHaveBeenCalled()
		expect(update).toHaveBeenCalledOnce()
	})

	it('still resolves from raw tallies when the option resolve fails', async () => {
		resolveEffectivePollOptions.mockRejectedValue(new Error('source down'))
		const { payload } = payloadWith({ type: 'mostVoted', resultsField: 'winner' })
		const recorded = await resolvePollOutcome({ payload, formId: 1, pollVotesEnabled: true })
		expect(recorded).toEqual(['ada'])
		expect(aggregateFromVotes).toHaveBeenCalledWith(expect.objectContaining({ options: [] }))
	})

	it('keeps the submission scan when the store is disabled', async () => {
		const { payload } = payloadWith({ type: 'mostVoted', resultsField: 'winner' })
		const recorded = await resolvePollOutcome({ payload, formId: 1 })
		expect(recorded).toEqual(['ada'])
		expect(aggregateFieldResponses).toHaveBeenCalledOnce()
		expect(aggregateFromVotes).not.toHaveBeenCalled()
	})
})
