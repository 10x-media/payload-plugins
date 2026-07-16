import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { definePollOptionSource } from './definePollOptionSource'
import type { PollOptionSourceRegistry } from './registry'
import { stashPollOptionSources } from './resolvePollOptions'
import { resolvePollOutcome } from './resolvePollOutcome'

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
		'plain',
		definePollOptionSource({
			type: 'plain',
			label: 'Plain',
			resolve: () => [],
		}),
	],
])

const payloadWith = (poll: unknown) => {
	const findByID = vi.fn().mockResolvedValue({ id: 1, title: 'Race', poll })
	const update = vi.fn().mockResolvedValue({})
	const payload = {
		findByID,
		update,
		config: { custom: stashPollOptionSources(undefined, sources) },
	} as unknown as Payload
	return { payload, findByID, update }
}

describe('resolvePollOutcome', () => {
	it('writes an explicit outcome with overrideAccess and leaves stamping to the hook', async () => {
		const { payload, update } = payloadWith({ enabled: true, resultsField: 'winner' })
		const recorded = await resolvePollOutcome({ payload, formId: 1, winningValue: 'ada' })
		expect(recorded).toBe('ada')
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
		expect(args.data.poll.outcome).toEqual({ winningValue: 'ada' })
	})

	it('resolves the winner via the source resolveOutcome when winningValue is omitted', async () => {
		const { payload, update } = payloadWith({
			enabled: true,
			optionSource: 'athletes',
			sourceConfig: { winner: 'ada' },
		})
		const recorded = await resolvePollOutcome({ payload, formId: 1 })
		expect(recorded).toBe('ada')
		const args = update.mock.calls[0]?.[0] as { data: { poll: { outcome: unknown } } }
		expect(args.data.poll.outcome).toEqual({ winningValue: 'ada' })
	})

	it('explains auto-mode failures without writing', async () => {
		const noSource = payloadWith({ enabled: true })
		await expect(resolvePollOutcome({ payload: noSource.payload, formId: 1 })).rejects.toThrow(
			/no poll option source/
		)
		expect(noSource.update).not.toHaveBeenCalled()

		const unregistered = payloadWith({ enabled: true, optionSource: 'ghost' })
		await expect(resolvePollOutcome({ payload: unregistered.payload, formId: 1 })).rejects.toThrow(
			/not registered/
		)

		const noResolver = payloadWith({ enabled: true, optionSource: 'plain' })
		await expect(resolvePollOutcome({ payload: noResolver.payload, formId: 1 })).rejects.toThrow(
			/does not implement resolveOutcome/
		)

		const undecided = payloadWith({ enabled: true, optionSource: 'athletes', sourceConfig: {} })
		await expect(resolvePollOutcome({ payload: undecided.payload, formId: 1 })).rejects.toThrow(
			/not be decided yet/
		)
		expect(undecided.update).not.toHaveBeenCalled()
	})

	it('rejects a form that is not poll-enabled', async () => {
		const { payload, update } = payloadWith({ enabled: false })
		await expect(resolvePollOutcome({ payload, formId: 1, winningValue: 'ada' })).rejects.toThrow(
			/not poll-enabled/
		)
		expect(update).not.toHaveBeenCalled()
	})

	it('rejects a form without a poll group', async () => {
		const { payload, update } = payloadWith(null)
		await expect(resolvePollOutcome({ payload, formId: 1, winningValue: 'ada' })).rejects.toThrow(
			/not poll-enabled/
		)
		expect(update).not.toHaveBeenCalled()
	})
})
