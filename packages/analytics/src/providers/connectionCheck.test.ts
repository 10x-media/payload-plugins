import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { HostRefusedError } from '../core/sourceErrors'
import { memoryAdapter } from '../testing/memoryAdapter'
import { checkConnectionOf, createConnectionRecheck } from './connectionCheck'
import type { ConnectionOutcome } from './connectionState'
import { failingAdapter } from './factory'
import type { ProviderStatusStore } from './status'

const payload = {} as Payload

const storeRecording = (recorded: Array<[string, ConnectionOutcome]>): ProviderStatusStore => ({
	record: async (docId, outcome) => {
		recorded.push([docId, outcome])
	},
	read: async () => undefined,
	readMany: async () => new Map(),
	forget: async () => {},
	carry: async () => {},
	idle: async () => {},
})

describe('checkConnectionOf', () => {
	it('words a refused host as a refusal, without the address it resolved to', async () => {
		const adapter = failingAdapter(
			{ id: 'plausible:1', label: 'Plausible', capabilities: memoryAdapter().capabilities },
			() => new HostRefusedError('analytics.internal', 'it is not on providers.hosts.allow')
		)
		expect(await checkConnectionOf(payload, adapter)).toEqual({
			ok: false,
			kind: 'source_misconfigured',
		})
	})
})

describe('createConnectionRecheck', () => {
	const setup = () => {
		const recorded: Array<[string, ConnectionOutcome]> = []
		const clock = { at: 0 }
		const adapterFor = vi.fn(async () => ({
			...memoryAdapter(),
			checkConnection: async () => {},
		}))
		const recheck = createConnectionRecheck({
			payload,
			store: storeRecording(recorded),
			adapterFor,
			now: () => clock.at,
			cooldownMs: 600_000,
			warn: () => {},
		})
		return { recorded, clock, adapterFor, recheck }
	}

	it('writes what the check found, and idle waits for it', async () => {
		const { recorded, recheck } = setup()
		recheck.request('doc-1')
		await recheck.idle()
		expect(recorded).toEqual([['doc-1', { ok: true }]])
	})

	it('checks one document at most once per cooldown, however many reads ask', async () => {
		const { adapterFor, clock, recheck } = setup()
		recheck.request('doc-1')
		recheck.request('doc-1')
		clock.at = 599_999
		recheck.request('doc-1')
		await recheck.idle()
		expect(adapterFor).toHaveBeenCalledTimes(1)
		clock.at = 600_000
		recheck.request('doc-1')
		await recheck.idle()
		expect(adapterFor).toHaveBeenCalledTimes(2)
	})

	// The native document's adapter is the instance's shared engine, lent rather than built.
	it('holds only the documents still inside the cooldown', async () => {
		const { clock, recheck } = setup()
		recheck.request('doc-1')
		clock.at = 599_999
		recheck.request('doc-2')
		expect(recheck.size).toBe(2)
		clock.at = 1_200_000
		recheck.request('doc-3')
		await recheck.idle()
		expect(recheck.size).toBe(1)
	})

	it('writes nothing for an adapter with no connection to check, and leaves it open', async () => {
		const recorded: Array<[string, ConnectionOutcome]> = []
		const close = vi.fn(async () => {})
		const recheck = createConnectionRecheck({
			payload,
			store: storeRecording(recorded),
			adapterFor: async () => ({ ...memoryAdapter(), close }),
			now: () => 0,
			cooldownMs: 600_000,
			warn: () => {},
		})
		recheck.request('doc-1')
		await recheck.idle()
		expect(recorded).toEqual([])
		expect(close).not.toHaveBeenCalled()
	})

	it('logs a check that could not run, and writes nothing', async () => {
		const recorded: Array<[string, ConnectionOutcome]> = []
		const warn = vi.fn()
		const recheck = createConnectionRecheck({
			payload,
			store: storeRecording(recorded),
			adapterFor: async () => {
				throw new Error('cannot decrypt')
			},
			now: () => 0,
			cooldownMs: 600_000,
			warn,
		})
		recheck.request('doc-1')
		await recheck.idle()
		expect(recorded).toEqual([])
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('doc-1'))
	})
})
