import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { definePollOptionSource } from './definePollOptionSource'
import { resolvePollOptionSources } from './registry'
import {
	pollOptionSourcesOf,
	resolvePollOptions,
	stashPollOptionSources,
} from './resolvePollOptions'

const options = [
	{ label: 'Ada', value: 'ada' },
	{ label: 'Grace', value: 'grace' },
]

const makeSource = (resolve = vi.fn().mockResolvedValue(options)) => ({
	source: definePollOptionSource({ type: 'athletes', label: 'Athletes', resolve }),
	resolve,
})

const payloadWith = (custom: Record<string, unknown> | undefined): Payload =>
	({ config: { custom } }) as unknown as Payload

describe('stashPollOptionSources / pollOptionSourcesOf', () => {
	it('round-trips the registry through config.custom, preserving other custom entries', () => {
		const { source } = makeSource()
		const registry = resolvePollOptionSources({ athletes: source })
		const custom = stashPollOptionSources({ other: 1 }, registry)
		expect(custom.other).toBe(1)
		expect(pollOptionSourcesOf(payloadWith(custom))).toBe(registry)
	})

	it('returns an empty registry when nothing was stashed', () => {
		expect(pollOptionSourcesOf(payloadWith(undefined)).size).toBe(0)
		expect(pollOptionSourcesOf(payloadWith({})).size).toBe(0)
	})
})

describe('resolvePollOptions', () => {
	it('returns undefined when the poll is disabled or has no optionSource', async () => {
		const payload = payloadWith({})
		expect(
			await resolvePollOptions({ payload, form: { id: 1, pollEnabled: true, poll: {} } })
		).toBeUndefined()
		expect(
			await resolvePollOptions({
				payload,
				form: { id: 1, pollEnabled: false, poll: { optionSource: 'athletes' } },
			})
		).toBeUndefined()
		expect(await resolvePollOptions({ payload, form: { id: 1 } })).toBeUndefined()
	})

	it('resolves through the stashed registry, passing config and form', async () => {
		const { source, resolve } = makeSource()
		const payload = payloadWith(
			stashPollOptionSources({}, resolvePollOptionSources({ athletes: source }))
		)
		const form = {
			id: 7,
			title: 'Race',
			pollEnabled: true,
			poll: { optionSource: 'athletes', sourceConfig: { eventId: 'e1' } },
		}
		const out = await resolvePollOptions({ payload, form })
		expect(out).toEqual(options)
		expect(resolve).toHaveBeenCalledWith({
			config: { eventId: 'e1' },
			form: { id: 7, title: 'Race' },
			payload,
			req: undefined,
		})
	})

	it('prefers an explicit sources registry over the stashed one', async () => {
		const { source, resolve } = makeSource()
		const payload = payloadWith({})
		const out = await resolvePollOptions({
			payload,
			form: { id: 1, pollEnabled: true, poll: { optionSource: 'athletes' } },
			sources: resolvePollOptionSources({ athletes: source }),
		})
		expect(out).toEqual(options)
		expect(resolve).toHaveBeenCalledOnce()
	})

	it('throws when the configured source type is not registered', async () => {
		const payload = payloadWith({})
		await expect(
			resolvePollOptions({
				payload,
				form: { id: 1, pollEnabled: true, poll: { optionSource: 'ghost' } },
			})
		).rejects.toThrow(/not registered/)
	})

	it('caches per request by form id', async () => {
		const { source, resolve } = makeSource()
		const payload = payloadWith(
			stashPollOptionSources({}, resolvePollOptionSources({ athletes: source }))
		)
		const req = { context: {} } as unknown as PayloadRequest
		const form = { id: 7, pollEnabled: true, poll: { optionSource: 'athletes' } }
		const first = await resolvePollOptions({ payload, req, form })
		const second = await resolvePollOptions({ payload, req, form })
		expect(resolve).toHaveBeenCalledOnce()
		expect(second).toBe(first)
		const other = await resolvePollOptions({ payload, req, form: { ...form, id: 8 } })
		expect(other).toEqual(options)
		expect(resolve).toHaveBeenCalledTimes(2)
	})
})
