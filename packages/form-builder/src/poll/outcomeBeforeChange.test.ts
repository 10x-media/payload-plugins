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

describe('pollOutcomeBeforeChange', () => {
	it('leaves data untouched when no winningValue is being written', async () => {
		const noPoll = { title: 'Race' }
		expect(await run(noPoll)).toBe(noPoll)
		const noOutcome = { pollEnabled: true, poll: {} }
		expect(await run(noOutcome)).toBe(noOutcome)
		const noWinning = { pollEnabled: true, poll: { outcome: { resolvedAt: '2020-01-01' } } }
		expect(await run(noWinning)).toBe(noWinning)
		expect((noWinning.poll.outcome as Record<string, unknown>).resolvedAt).toBe('2020-01-01')
	})

	it('stamps resolvedAt when a valid winner is set', async () => {
		const data = baseDoc({ winningValue: 'ada' })
		const before = Date.now()
		await run(data, baseDoc())
		const outcome = data.poll.outcome as { winningValue?: string; resolvedAt?: string }
		expect(outcome.winningValue).toBe('ada')
		const stamped = Date.parse(outcome.resolvedAt ?? '')
		expect(stamped).toBeGreaterThanOrEqual(before)
		expect(stamped).toBeLessThanOrEqual(Date.now())
	})

	it('restamps when the winner changes and preserves the stamp when it does not', async () => {
		const original = baseDoc({ winningValue: 'ada', resolvedAt: '2020-01-01T00:00:00.000Z' })
		const unchanged = baseDoc({ winningValue: 'ada', resolvedAt: '2020-01-01T00:00:00.000Z' })
		await run(unchanged, original)
		expect((unchanged.poll.outcome as { resolvedAt?: string }).resolvedAt).toBe(
			'2020-01-01T00:00:00.000Z'
		)

		const changed = baseDoc({ winningValue: 'grace', resolvedAt: '2020-01-01T00:00:00.000Z' })
		await run(changed, original)
		const restamped = (changed.poll.outcome as { resolvedAt?: string }).resolvedAt ?? ''
		expect(Date.parse(restamped)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'))
	})

	it('clears resolvedAt and normalizes the value when the winner is cleared', async () => {
		const data = baseDoc({ winningValue: '', resolvedAt: '2020-01-01T00:00:00.000Z' })
		await run(data, baseDoc({ winningValue: 'ada', resolvedAt: '2020-01-01T00:00:00.000Z' }))
		const outcome = data.poll.outcome as { winningValue?: unknown; resolvedAt?: unknown }
		expect(outcome.winningValue).toBeNull()
		expect(outcome.resolvedAt).toBeNull()
	})

	it('allows clearing even when the poll is disabled', async () => {
		const data = { pollEnabled: false, poll: { outcome: { winningValue: null } } }
		await run(data, baseDoc({ winningValue: 'ada' }))
		expect((data.poll.outcome as { resolvedAt?: unknown }).resolvedAt).toBeNull()
	})

	it('rejects a winner on a disabled poll', async () => {
		const data = { pollEnabled: false, poll: { outcome: { winningValue: 'ada' } } }
		const errors = await errorsOf(run(data, baseDoc()))
		expect(errors[0]?.path).toBe('poll.outcome.winningValue')
		expect(errors[0]?.message).toBe(keys.validationWinningValueDisabled)
	})

	it('rejects a winner outside the effective options', async () => {
		const errors = await errorsOf(run(baseDoc({ winningValue: 'zorro' }), baseDoc()))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('validates a partial update against the stored doc', async () => {
		const partial = { poll: { outcome: { winningValue: 'grace' } } }
		await run(partial, baseDoc())
		expect((partial.poll.outcome as { resolvedAt?: string }).resolvedAt).toBeTruthy()

		const invalid = { poll: { outcome: { winningValue: 'zorro' } } }
		const errors = await errorsOf(run(invalid, baseDoc()))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('validates against source-resolved options when an option source is set', async () => {
		const sourced = baseDoc({ winningValue: 'linus' })
		;(sourced.poll as Record<string, unknown>).optionSource = 'athletes'
		await run(sourced, undefined)
		expect((sourced.poll.outcome as { resolvedAt?: string }).resolvedAt).toBeTruthy()

		const authoredOnly = baseDoc({ winningValue: 'ada' })
		;(authoredOnly.poll as Record<string, unknown>).optionSource = 'athletes'
		const errors = await errorsOf(run(authoredOnly, undefined))
		expect(errors[0]?.message).toBe(keys.validationWinningValueUnknown)
	})

	it('fails closed when the source cannot resolve', async () => {
		const data = baseDoc({ winningValue: 'linus' })
		;(data.poll as Record<string, unknown>).optionSource = 'athletes'
		;(data.poll as Record<string, unknown>).sourceConfig = { fail: true }
		const errors = await errorsOf(run(data, undefined))
		expect(errors[0]?.message).toBe(keys.pollOptionsUnavailable)
	})
})
