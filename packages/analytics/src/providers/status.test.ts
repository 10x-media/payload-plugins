import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import { vendorWordsOf } from './connectionState'
import {
	connectionOutcomeOf,
	providerStatusKey,
	providerStatusStore,
	STATUS_MEMO_MS,
	STATUS_SUCCESS_EVERY_MS,
} from './status'

type Row = Record<string, unknown>

/** `payload.kv` over a map, counting the writes that reach it. */
const fakePayload = (options: { failWrites?: number } = {}) => {
	const rows = new Map<string, Row>()
	let failures = options.failWrites ?? 0
	const writes: Row[] = []
	const gets: string[] = []
	const payload = {
		kv: {
			get: async (key: string) => {
				gets.push(key)
				return rows.get(key) ?? null
			},
			set: async (key: string, data: Row) => {
				if (failures > 0) {
					failures--
					throw new Error('the database is down')
				}
				writes.push(data)
				rows.set(key, data)
			},
			delete: async (key: string) => {
				rows.delete(key)
			},
		},
	} as unknown as Payload
	return { payload, rows, writes, gets }
}

const clock = (start = Date.parse('2026-11-09T10:00:00.000Z')) => {
	let at = start
	return { now: () => new Date(at), advance: (ms: number) => (at += ms) }
}

describe('connectionOutcomeOf', () => {
	it('reads a success as working', () => {
		expect(connectionOutcomeOf({ ok: true }, { open: false })).toEqual({ ok: true })
	})

	it('keeps the vendor’s words and how long the source rests', () => {
		const error = new ProviderHttpError(
			403,
			'posthog',
			'posthog: HTTP 403 {"detail":"Invalid personal API key."}'
		)
		expect(
			connectionOutcomeOf(
				{ ok: false, failure: { kind: 'source_misconfigured' }, error },
				{ open: true, retryAfterMs: 30_000 }
			)
		).toEqual({
			ok: false,
			kind: 'source_misconfigured',
			detail: 'posthog: HTTP 403 {"detail":"Invalid personal API key."}',
			pausedForMs: 30_000,
		})
	})

	it('keeps no detail the vendor did not say: the plugin’s own refusal and a network error', () => {
		for (const error of [
			new Error('umami: no website w; check the Website ID'),
			new TypeError('fetch failed'),
		]) {
			expect(
				connectionOutcomeOf(
					{ ok: false, failure: { kind: 'source_misconfigured' }, error },
					{ open: true }
				)
			).toEqual({ ok: false, kind: 'source_misconfigured' })
		}
	})

	it('keeps no detail of a refused host, which can name the address it resolved to', () => {
		expect(
			connectionOutcomeOf(
				{
					ok: false,
					failure: { kind: 'source_misconfigured', hostRefused: true },
					error: new Error('refused 10.0.0.5'),
				},
				{ open: true }
			)
		).toEqual({ ok: false, kind: 'source_misconfigured' })
	})

	it('says nothing for a read refused as asked or held back by the plugin’s own limit', () => {
		expect(
			connectionOutcomeOf({ ok: false, failure: { kind: 'invalid_param' } }, { open: false })
		).toBeUndefined()
		expect(
			connectionOutcomeOf({ ok: false, failure: { kind: 'rate_limited' } }, { open: false })
		).toBeUndefined()
	})
})

describe('providerStatusStore', () => {
	it('keeps the row under the document’s key, merging each result into it', async () => {
		const { payload, rows } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, time)
		await store.record('6650f1c2a9e4b3d2c1a09f87', { ok: true })
		time.advance(1000)
		await store.record('6650f1c2a9e4b3d2c1a09f87', {
			ok: false,
			kind: 'unavailable',
			detail: 'posthog: HTTP 503',
			pausedForMs: 60_000,
		})
		expect([...rows.keys()]).toEqual(['analytics:provider-status:6650f1c2a9e4b3d2c1a09f87'])
		expect(await store.read('6650f1c2a9e4b3d2c1a09f87')).toEqual({
			lastSuccessAt: '2026-11-09T10:00:00.000Z',
			lastErrorAt: '2026-11-09T10:00:01.000Z',
			errorKind: 'unavailable',
			errorDetail: 'posthog: HTTP 503',
			pausedUntil: '2026-11-09T10:01:01.000Z',
		})
	})

	it('keeps the reason of the last failure, which a failure without one clears', async () => {
		const { payload } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, time)
		await store.record('7', { ok: false, kind: 'source_misconfigured', reason: 'unknownSite' })
		expect((await store.read('7'))?.errorReason).toBe('unknownSite')
		time.advance(1000)
		await store.record('7', { ok: true })
		expect((await store.read('7'))?.errorReason).toBe('unknownSite')
		time.advance(1000)
		await store.record('7', { ok: false, kind: 'source_misconfigured' })
		expect((await store.read('7'))?.errorReason).toBeUndefined()
	})

	it('clears the pause on a success and keeps the last failure beside it', async () => {
		const { payload } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, time)
		await store.record('5', { ok: false, kind: 'source_misconfigured', pausedForMs: 30_000 })
		time.advance(1000)
		await store.record('5', { ok: true })
		expect(await store.read('5')).toEqual({
			lastSuccessAt: '2026-11-09T10:00:01.000Z',
			lastErrorAt: '2026-11-09T10:00:00.000Z',
			errorKind: 'source_misconfigured',
		})
	})

	it('writes a throttled success at most every 15 minutes, and at once after a failure', async () => {
		const { payload, writes } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, time)
		await store.record('5', { ok: true }, { throttle: true })
		time.advance(STATUS_SUCCESS_EVERY_MS - 1)
		await store.record('5', { ok: true }, { throttle: true })
		expect(writes).toHaveLength(1)
		time.advance(1)
		await store.record('5', { ok: true }, { throttle: true })
		expect(writes).toHaveLength(2)
		await store.record('5', { ok: false, kind: 'unavailable' }, { throttle: true })
		await store.record('5', { ok: true }, { throttle: true })
		expect(writes).toHaveLength(4)
	})

	it('writes an unthrottled success every time, as the Test connection button asks', async () => {
		const { payload, writes } = fakePayload()
		const store = providerStatusStore(payload, clock())
		await store.record('5', { ok: true })
		await store.record('5', { ok: true })
		expect(writes).toHaveLength(2)
	})

	it('writes the next success after one that failed to save, whatever the throttle says', async () => {
		const { payload, writes } = fakePayload({ failWrites: 1 })
		const store = providerStatusStore(payload, clock())
		await expect(store.record('5', { ok: true }, { throttle: true })).rejects.toThrow('down')
		await store.record('5', { ok: true }, { throttle: true })
		expect(writes).toHaveLength(1)
	})

	it('lands one document’s writes in the order they were recorded', async () => {
		const { payload, rows } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, time)
		const first = store.record('5', { ok: true })
		time.advance(1000)
		const second = store.record('5', { ok: false, kind: 'unavailable' })
		await Promise.all([first, second])
		expect(rows.get(providerStatusKey('5'))).toMatchObject({
			lastSuccessAt: '2026-11-09T10:00:00.000Z',
			lastErrorAt: '2026-11-09T10:00:01.000Z',
		})
	})

	// Two instances share the rows but each keeps its own throttle.
	it('writes a throttled success once it reads that another instance recorded a failure', async () => {
		const { payload } = fakePayload()
		const time = clock()
		const a = providerStatusStore(payload, time)
		const b = providerStatusStore(payload, time)
		await b.record('5', { ok: true }, { throttle: true })
		time.advance(60_000)
		await a.record('5', { ok: false, kind: 'source_misconfigured' })
		await b.readMany(['5'])
		time.advance(60_000)
		await b.record('5', { ok: true }, { throttle: true })
		expect(await b.read('5')).toMatchObject({ lastSuccessAt: '2026-11-09T10:02:00.000Z' })
	})

	it('writes a throttled success once it reads that another instance forgot the row', async () => {
		const { payload } = fakePayload()
		const time = clock()
		const a = providerStatusStore(payload, time)
		const b = providerStatusStore(payload, time)
		await b.record('5', { ok: true }, { throttle: true })
		await a.forget('5')
		await b.read('5')
		time.advance(60_000)
		await b.record('5', { ok: true }, { throttle: true })
		expect(await b.read('5')).toEqual({ lastSuccessAt: '2026-11-09T10:01:00.000Z' })
	})

	it('answers the reads every request makes from memory for a few seconds', async () => {
		const { payload, gets } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, time)
		await store.readMany(['5'])
		await store.readMany(['5'])
		expect(gets).toHaveLength(1)
		time.advance(STATUS_MEMO_MS)
		await store.readMany(['5'])
		expect(gets).toHaveLength(2)
		await store.record('5', { ok: false, kind: 'unavailable' })
		expect((await store.readMany(['5'])).get('5')).toMatchObject({ errorKind: 'unavailable' })
		await store.read('5')
		expect(gets).toHaveLength(5)
	})

	it('answers a row about another saved version of the document as none', async () => {
		const { payload } = fakePayload()
		const store = providerStatusStore(payload, clock())
		await store.record('5', { ok: false, kind: 'source_misconfigured' }, { version: 'v1' })
		expect(await store.read('5', 'v2')).toBeUndefined()
		expect((await store.readMany(['5'], () => 'v2')).has('5')).toBe(false)
		expect(await store.read('5', 'v1')).toMatchObject({ errorKind: 'source_misconfigured' })
		expect((await store.readMany(['5'], () => 'v1')).get('5')).toMatchObject({
			errorKind: 'source_misconfigured',
		})
	})

	it('forgets a document’s row after the writes already queued for it', async () => {
		const { payload, rows } = fakePayload()
		const store = providerStatusStore(payload, clock())
		const written = store.record('5', { ok: false, kind: 'unavailable' })
		await store.forget('5')
		await written
		expect(rows.has(providerStatusKey('5'))).toBe(false)
		expect(await store.read('5')).toBeUndefined()
	})

	it('cuts a vendor message past 300 characters', async () => {
		const { payload } = fakePayload()
		const store = providerStatusStore(payload, clock())
		await store.record('5', { ok: false, kind: 'unavailable', detail: 'x'.repeat(5000) })
		expect((await store.read('5'))?.errorDetail).toHaveLength(300)
	})
})

describe('vendorWordsOf', () => {
	it('splits a refusal fetchJson worded into the vendor and its message, leaving the status out', () => {
		expect(vendorWordsOf('posthog: HTTP 403 Invalid personal API key.')).toEqual({
			provider: 'posthog',
			message: 'Invalid personal API key.',
		})
		expect(vendorWordsOf('umami: HTTP 502')).toEqual({
			provider: 'umami',
			message: '',
		})
	})

	it('keeps any other text as the message, a provider it does not know included', () => {
		expect(vendorWordsOf('  7 PERMISSION_DENIED: no access  ')).toEqual({
			message: '7 PERMISSION_DENIED: no access',
		})
		expect(vendorWordsOf('custom: HTTP 403 nope')).toEqual({ message: 'custom: HTTP 403 nope' })
	})
})
