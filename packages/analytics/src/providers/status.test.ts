import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import { vendorWordsOf } from './connectionState'
import {
	connectionOutcomeOf,
	PROVIDER_STATUS_SLUG,
	providerStatusCollection,
	providerStatusStore,
	STATUS_SUCCESS_EVERY_MS,
} from './status'

type Row = Record<string, unknown>

/** Payload's database API over a map keyed by id, counting the writes that reach it. */
const fakePayload = (options: { failWrites?: number } = {}) => {
	const rows = new Map<string, Row>()
	let failures = options.failWrites ?? 0
	const writes: Row[] = []
	const write = (id: string, data: Row): void => {
		if (failures > 0) {
			failures--
			throw new Error('the database is down')
		}
		writes.push(data)
		rows.set(id, { ...rows.get(id), ...data, id })
	}
	const idOf = (where: { id: { equals: string } }) => where.id.equals
	const payload = {
		collections: { [PROVIDER_STATUS_SLUG]: {} },
		db: {
			find: async ({ where }: { where: { id: { equals: string } } }) => {
				const row = rows.get(idOf(where))
				return { docs: row ? [row] : [] }
			},
			create: async ({ data }: { data: Row }) => write(String(data.id), data),
			updateOne: async ({ id, data }: { id: string; data: Row }) => write(id, data),
		},
	} as unknown as Payload
	return { payload, rows, writes }
}

const clock = (start = Date.parse('2026-11-09T10:00:00.000Z')) => {
	let at = start
	return { now: () => new Date(at), advance: (ms: number) => (at += ms) }
}

describe('providerStatusCollection', () => {
	it('keys each row by a text id, the provider document’s own', () => {
		const collection = providerStatusCollection()
		expect(collection.slug).toBe('analytics-provider-status')
		expect(collection.fields[0]).toEqual({ name: 'id', type: 'text' })
		expect(collection.access?.read?.({} as never)).toBe(false)
	})
})

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
	it('creates the row under the document id, then updates it', async () => {
		const { payload, rows } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, time)
		await store.record('6650f1c2a9e4b3d2c1a09f87', { ok: true })
		time.advance(1000)
		await store.record('6650f1c2a9e4b3d2c1a09f87', {
			ok: false,
			kind: 'unavailable',
			detail: 'posthog: HTTP 503',
			pausedForMs: 60_000,
		})
		expect([...rows.keys()]).toEqual(['6650f1c2a9e4b3d2c1a09f87'])
		expect(await store.read('6650f1c2a9e4b3d2c1a09f87')).toEqual({
			lastSuccessAt: '2026-11-09T10:00:00.000Z',
			lastErrorAt: '2026-11-09T10:00:01.000Z',
			errorKind: 'unavailable',
			errorDetail: 'posthog: HTTP 503',
			pausedUntil: '2026-11-09T10:01:01.000Z',
		})
	})

	it('clears the pause on a success and keeps the last failure beside it', async () => {
		const { payload } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, time)
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
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, time)
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
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, clock())
		await store.record('5', { ok: true })
		await store.record('5', { ok: true })
		expect(writes).toHaveLength(2)
	})

	it('writes the next success after one that failed to save, whatever the throttle says', async () => {
		const { payload, writes } = fakePayload({ failWrites: 1 })
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, clock())
		await expect(store.record('5', { ok: true }, { throttle: true })).rejects.toThrow('down')
		await store.record('5', { ok: true }, { throttle: true })
		expect(writes).toHaveLength(1)
	})

	it('lands one document’s writes in the order they were recorded', async () => {
		const { payload, rows } = fakePayload()
		const time = clock()
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, time)
		const first = store.record('5', { ok: true })
		time.advance(1000)
		const second = store.record('5', { ok: false, kind: 'unavailable' })
		await Promise.all([first, second])
		expect(rows.get('5')).toMatchObject({
			lastSuccessAt: '2026-11-09T10:00:00.000Z',
			lastErrorAt: '2026-11-09T10:00:01.000Z',
		})
	})

	it('cuts a vendor message past 300 characters', async () => {
		const { payload } = fakePayload()
		const store = providerStatusStore(payload, PROVIDER_STATUS_SLUG, clock())
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
