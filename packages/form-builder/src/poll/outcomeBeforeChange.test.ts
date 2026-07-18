import type { Payload, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'
import { keys } from '../translations/keys'
import { definePollOptionSource } from './definePollOptionSource'
import { pollOutcomeBeforeChange } from './outcomeBeforeChange'
import type { PollOptionSourceRegistry } from './registry'
import { stashPollOptionSources } from './resolvePollOptions'

const sources: PollOptionSourceRegistry = new Map([
	[
		'athletes',
		definePollOptionSource({
			type: 'athletes',
			label: 'Athletes',
			resolve: ({ config }) => {
				if (config.fail === true) {
					throw new Error('source down')
				}
				return [{ label: 'Linus', value: 'linus' }]
			},
		}),
	],
])

const payload = {
	config: { custom: stashPollOptionSources(undefined, sources) },
} as unknown as Payload

const req = { payload, t: (key: string) => key } as unknown as PayloadRequest

const options = [
	{ label: 'Ada', value: 'ada' },
	{ label: 'Grace', value: 'grace' },
]

const baseDoc = (outcome?: Record<string, unknown>) => ({
	id: 7,
	title: 'Race',
	pollEnabled: true,
	fields: [{ blockType: 'select', name: 'winner', label: 'Winner', options }],
	poll: { resultsField: 'winner', outcome },
})

type HookArgs = Parameters<typeof pollOutcomeBeforeChange>[0]

const run = (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) =>
	pollOutcomeBeforeChange({ data, originalDoc, req } as unknown as HookArgs)

const errorsOf = async (promise: Promise<unknown>) => {
	try {
		await promise
	} catch (error) {
		expect(error).toBeInstanceOf(ValidationError)
		return (error as ValidationError).data.errors
	}
	throw new Error('expected a ValidationError')
}

type OutcomeShape = { winningValues?: unknown; resolvedAt?: unknown }

describe('pollOutcomeBeforeChange', () => {
	it('leaves data untouched when no winningValues is being written', async () => {
		const noPoll = { title: 'Race' }
		expect(await run(noPoll)).toBe(noPoll)
		const noOutcome = { pollEnabled: true, poll: {} }
		expect(await run(noOutcome)).toBe(noOutcome)
		const noWinning = { pollEnabled: true, poll: { outcome: { resolvedAt: '2020-01-01' } } }
		expect(await run(noWinning)).toBe(noWinning)
		expect((noWinning.poll.outcome as OutcomeShape).resolvedAt).toBe('2020-01-01')
	})

	it('stamps resolvedAt when a valid single winner is set', async () => {
		const data = baseDoc({ winningValues: ['ada'] })
		const before = Date.now()
		await run(data, baseDoc())
		const outcome = data.poll.outcome as OutcomeShape
		expect(outcome.winningValues).toEqual(['ada'])
		const stamped = Date.parse((outcome.resolvedAt as string) ?? '')
		expect(stamped).toBeGreaterThanOrEqual(before)
		expect(stamped).toBeLessThanOrEqual(Date.now())
	})

	it('records a tie of several winners and stamps resolvedAt', async () => {
		const data = baseDoc({ winningValues: ['ada', 'grace'] })
		const before = Date.now()
		await run(data, baseDoc())
		const outcome = data.poll.outcome as OutcomeShape
		expect(outcome.winningValues).toEqual(['ada', 'grace'])
		expect(Date.parse((outcome.resolvedAt as string) ?? '')).toBeGreaterThanOrEqual(before)
	})

	it('drops empty and duplicate entries from the stored set', async () => {
		const data = baseDoc({ winningValues: ['ada', '', 'ada', 'grace'] })
		await run(data, baseDoc())
		expect((data.poll.outcome as OutcomeShape).winningValues).toEqual(['ada', 'grace'])
	})

	it('rejects a tie when any winner is outside the effective options', async () => {
		const errors = await errorsOf(run(baseDoc({ winningValues: ['ada', 'zorro'] }), baseDoc()))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('restamps when the set changes and stamps regardless of an inbound resolvedAt', async () => {
		const original = baseDoc({
			winningValues: ['ada'],
			resolvedAt: '2020-01-01T00:00:00.000Z',
		})
		const changed = baseDoc({
			winningValues: ['ada', 'grace'],
			resolvedAt: '2020-01-01T00:00:00.000Z',
		})
		await run(changed, original)
		const restamped = (changed.poll.outcome as OutcomeShape).resolvedAt as string
		expect(Date.parse(restamped)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'))
	})

	it('is a no-op for an unchanged set even when reordered, preserving resolvedAt', async () => {
		const original = baseDoc({
			winningValues: ['ada', 'grace'],
			resolvedAt: '2020-01-01T00:00:00.000Z',
		})
		const reordered = baseDoc({
			winningValues: ['grace', 'ada'],
			resolvedAt: '2020-01-01T00:00:00.000Z',
		})
		await run(reordered, original)
		expect((reordered.poll.outcome as OutcomeShape).resolvedAt).toBe('2020-01-01T00:00:00.000Z')
	})

	it('clears resolvedAt and normalizes the value when the set is cleared', async () => {
		const data = baseDoc({ winningValues: [], resolvedAt: '2020-01-01T00:00:00.000Z' })
		await run(data, baseDoc({ winningValues: ['ada'], resolvedAt: '2020-01-01T00:00:00.000Z' }))
		const outcome = data.poll.outcome as OutcomeShape
		expect(outcome.winningValues).toEqual([])
		expect(outcome.resolvedAt).toBeNull()
	})

	it('allows clearing even when the poll is disabled', async () => {
		const data = { pollEnabled: false, poll: { outcome: { winningValues: [] } } }
		await run(data, baseDoc({ winningValues: ['ada'] }))
		expect((data.poll.outcome as OutcomeShape).resolvedAt).toBeNull()
	})

	it('rejects a winner on a disabled poll under the winningValues path', async () => {
		const data = { pollEnabled: false, poll: { outcome: { winningValues: ['ada'] } } }
		const errors = await errorsOf(run(data, baseDoc()))
		expect(errors[0]?.path).toBe('poll.outcome.winningValues')
		expect(errors[0]?.message).toBe(keys.validationWinningValueDisabled)
	})

	it('rejects a winner outside the effective options', async () => {
		const errors = await errorsOf(run(baseDoc({ winningValues: ['zorro'] }), baseDoc()))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('validates a partial update against the stored doc', async () => {
		const partial = { poll: { outcome: { winningValues: ['grace'] } } }
		await run(partial, baseDoc())
		expect((partial.poll.outcome as OutcomeShape).resolvedAt).toBeTruthy()

		const invalid = { poll: { outcome: { winningValues: ['zorro'] } } }
		const errors = await errorsOf(run(invalid, baseDoc()))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('validates against source-resolved options when an option source is set', async () => {
		const sourced = baseDoc({ winningValues: ['linus'] })
		;(sourced.poll as Record<string, unknown>).optionSource = 'athletes'
		await run(sourced, undefined)
		expect((sourced.poll.outcome as OutcomeShape).resolvedAt).toBeTruthy()

		const authoredOnly = baseDoc({ winningValues: ['ada'] })
		;(authoredOnly.poll as Record<string, unknown>).optionSource = 'athletes'
		const errors = await errorsOf(run(authoredOnly, undefined))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('fails closed when the source cannot resolve', async () => {
		const data = baseDoc({ winningValues: ['linus'] })
		;(data.poll as Record<string, unknown>).optionSource = 'athletes'
		;(data.poll as Record<string, unknown>).sourceConfig = { fail: true }
		const errors = await errorsOf(run(data, undefined))
		expect(errors[0]?.message).toBe(keys.pollOptionsUnavailable)
	})
})
