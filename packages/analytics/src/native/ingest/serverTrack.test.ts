import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../../core/contract'
import {
	AnalyticsTrackError,
	type ServerEventInput,
	type ServerTrack,
} from '../../core/serverEvent'
import type { Goal } from '../../goals/types'
import { type AnalyticsRuntime, setRuntime } from '../../plugin/runtime'
import { type GeoResolver, noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { SERVER_USER_AGENT } from './device'
import type { IngestResolvers } from './endpoint'
import { flushBatch } from './flushBatch'
import type { StoredEvent } from './normalizeEvent'
import { makeServerTrack, trackServerEvent } from './serverTrack'
import { dailyVisitorHash } from './visitorHash'
import type { WriteBuffer } from './writeBuffer'

vi.mock('./flushBatch', () => ({ flushBatch: vi.fn(async () => undefined) }))

const flushed = vi.mocked(flushBatch)

const fakePayload = (): Payload =>
	({
		kv: { get: async () => ({ salt: 'salt' }), set: async () => undefined },
	}) as unknown as Payload

const fakeReq = (headers: Record<string, string> = {}): PayloadRequest =>
	({ headers: new Headers(headers) }) as unknown as PayloadRequest

interface Harness {
	track: ServerTrack
	events: StoredEvent[]
	payload: Payload
	drain: ReturnType<typeof vi.fn>
}

const setup = (
	resolvers: IngestResolvers = {},
	buffered = true,
	geoResolver: GeoResolver = noopResolver
): Harness => {
	const events: StoredEvent[] = []
	const drain = vi.fn(async () => undefined)
	const buffer = {
		add: (event: StoredEvent) => events.push(event),
		flush: drain,
	} as unknown as WriteBuffer<StoredEvent>
	const payload = fakePayload()
	return {
		events,
		payload,
		drain,
		track: makeServerTrack({
			getPayload: () => payload,
			geoResolver,
			getBuffer: () => (buffered ? buffer : null),
			getResolvers: () => resolvers,
		}),
	}
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'

const pageview: ServerEventInput = { type: 'pageview', path: '/p', hostname: 'h' }

beforeEach(() => {
	flushed.mockClear()
})

describe('makeServerTrack attribution', () => {
	it('hashes the visitor from the given ip and user agent', async () => {
		const { track, events } = setup()
		await track({ ...pageview, ip: '1.2.3.4', userAgent: 'curl/8' })
		expect(events[0]?.visitorHash).toBe(
			dailyVisitorHash({ ip: '1.2.3.4', ua: 'curl/8', site: 'h', salt: 'salt' })
		)
	})

	it('hashes without an ip when only a user agent is given', async () => {
		const { track, events } = setup()
		await track({ ...pageview, userAgent: 'curl/8' })
		expect(events[0]?.visitorHash).toBe(
			dailyVisitorHash({ ip: '', ua: 'curl/8', site: 'h', salt: 'salt' })
		)
	})

	it('never fabricates an ip: an ip-less event hashes as the synthetic server visitor', async () => {
		const { track, events } = setup()
		await track(pageview)
		await track({ ...pageview, path: '/other' })
		expect(events[0]?.visitorHash).toBe(
			dailyVisitorHash({ ip: '', ua: SERVER_USER_AGENT, site: 'h', salt: 'salt' })
		)
		expect(events[1]?.visitorHash).toBe(events[0]?.visitorHash)
	})

	it('keeps the synthetic visitor per site', async () => {
		const { track, events } = setup()
		await track(pageview)
		await track({ ...pageview, hostname: 'other.example' })
		expect(events[1]?.visitorHash).not.toBe(events[0]?.visitorHash)
	})

	it('files an unattributed event under no device at all', async () => {
		const { track, events } = setup()
		await track(pageview)
		expect(events[0]?.device).toBeUndefined()
		expect(events[0]?.browser).toBeUndefined()
		expect(events[0]?.os).toBeUndefined()
	})

	it('extracts the utm keys from a query the caller passes, storing no query', async () => {
		const { track, events } = setup()
		await track({ ...pageview, query: 'utm_source=newsletter&utm_medium=email&token=secret' })
		expect(events[0]?.utmSource).toBe('newsletter')
		expect(events[0]?.utmMedium).toBe('email')
		expect(JSON.stringify(events[0])).not.toContain('secret')
	})

	it('classifies browser, os and language from the request it is given', async () => {
		const { track, events } = setup()
		const req = fakeReq({
			'user-agent':
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
			'accept-language': 'de-DE,de;q=0.9',
		})
		await track(pageview, { req })
		expect(events[0]?.browser).toBe('safari')
		expect(events[0]?.os).toBe('ios')
		expect(events[0]?.language).toBe('de-de')
	})

	it('inherits the whole header set of the request it is given', async () => {
		const { track, events } = setup({}, true, platformHeaderResolver)
		const req = fakeReq({
			'x-vercel-ip-country': 'US',
			'x-forwarded-for': '9.9.9.9',
			'user-agent': IPHONE_UA,
		})
		await track(pageview, { req })
		expect(events[0]?.country).toBe('US')
		expect(events[0]?.device).toBe('mobile')
		expect(events[0]?.visitorHash).toBe(
			dailyVisitorHash({ ip: '9.9.9.9', ua: IPHONE_UA, site: 'h', salt: 'salt' })
		)
	})

	it('overlays an explicit ip and user agent over the request’s own', async () => {
		const { track, events } = setup()
		const req = fakeReq({ 'x-forwarded-for': '9.9.9.9', 'user-agent': IPHONE_UA })
		await track({ ...pageview, ip: '1.2.3.4', userAgent: 'curl/8' }, { req })
		expect(events[0]?.visitorHash).toBe(
			dailyVisitorHash({ ip: '1.2.3.4', ua: 'curl/8', site: 'h', salt: 'salt' })
		)
	})

	it('falls back to the synthetic user agent for a request that carries none', async () => {
		const { track, events } = setup()
		await track(pageview, { req: fakeReq({ 'x-forwarded-for': '9.9.9.9' }) })
		expect(events[0]?.visitorHash).toBe(
			dailyVisitorHash({ ip: '9.9.9.9', ua: SERVER_USER_AGENT, site: 'h', salt: 'salt' })
		)
		expect(events[0]?.device).toBeUndefined()
	})
})

describe('makeServerTrack validation', () => {
	it('throws AnalyticsTrackError naming the missing field', async () => {
		const { track, events } = setup()
		await expect(
			track({ type: 'goal', path: '/p', hostname: 'h' } as ServerEventInput)
		).rejects.toThrow(/name/)
		await expect(track({ ...pageview, path: '' })).rejects.toThrow(/path/)
		await expect(track({ ...pageview, hostname: '' })).rejects.toThrow(/hostname/)
		expect(events).toEqual([])
	})

	it('throws rather than dropping, with the error named for a catch block', async () => {
		const { track } = setup()
		const err = await track({ ...pageview, path: '' }).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(AnalyticsTrackError)
		expect((err as Error).name).toBe('AnalyticsTrackError')
	})

	it('throws when the adapter has not booted yet', async () => {
		const track = makeServerTrack({
			getPayload: () => null,
			geoResolver: noopResolver,
			getBuffer: () => null,
			getResolvers: () => ({}),
		})
		await expect(track(pageview)).rejects.toThrow(AnalyticsTrackError)
	})
})

describe('makeServerTrack scope', () => {
	const scoped: IngestResolvers = { scope: async () => 'from-req' }

	it('stamps an explicit scope over the request', async () => {
		const { track, events } = setup(scoped)
		await track({ ...pageview, scope: 'alpha' }, { req: fakeReq() })
		expect(events[0]?.scope).toBe('alpha')
	})

	it('reads an explicit null as install-wide', async () => {
		const { track, events } = setup(scoped)
		await track({ ...pageview, scope: null }, { req: fakeReq() })
		expect(events[0]?.scope).toBe('')
	})

	it('resolves the scope from the request when none is given', async () => {
		const { track, events } = setup(scoped)
		await track(pageview, { req: fakeReq() })
		expect(events[0]?.scope).toBe('from-req')
	})

	it('is install-wide when neither a scope nor a request is given', async () => {
		const { track, events } = setup(scoped)
		await track(pageview)
		expect(events[0]?.scope).toBe('')
	})

	it('stamps no scope at all in an unscoped install', async () => {
		const { track, events } = setup()
		await track({ ...pageview, scope: 'alpha' })
		expect(events[0]?.scope).toBeUndefined()
	})
})

describe('makeServerTrack resolvers', () => {
	it('resolves goals under the scope the event is stamped with', async () => {
		const goals: Goal[] = [
			{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
		]
		const resolveGoals = vi.fn(async (_req: PayloadRequest, _scope?: string | null) => goals)
		const { track, events } = setup({ scope: async () => 'alpha', goals: resolveGoals })
		await track({ ...pageview, path: '/thank-you' }, { req: fakeReq() })
		expect(resolveGoals.mock.calls[0]?.[1]).toBe('alpha')
		expect(events[0]?.goals).toEqual([{ slug: 'thanks', value: 0 }])
	})

	it('carries the resolved timezone onto the event', async () => {
		const { track, events } = setup({ timezone: async () => 'Europe/Berlin' })
		await track(pageview, { req: fakeReq() })
		expect(events[0]?.timezone).toBe('Europe/Berlin')
	})

	it('prefers an explicit timezone over the resolver', async () => {
		const { track, events } = setup({ timezone: async () => 'Europe/Berlin' })
		await track({ ...pageview, timezone: 'UTC' }, { req: fakeReq() })
		expect(events[0]?.timezone).toBe('UTC')
	})

	it('sanitizes optional fields exactly as a browser event is sanitized', async () => {
		const { track, events } = setup()
		await track({
			...pageview,
			type: 'goal',
			name: 'purchase',
			value: 30,
			currency: 'euro',
			props: { plan: 'pro', nested: { no: true } },
		} as ServerEventInput)
		expect(events[0]).toMatchObject({ value: 30, props: { plan: 'pro' } })
		expect(events[0]?.currency).toBeUndefined()
	})

	it('leaves the caller’s request untouched', async () => {
		// createLocalReq mutates what it is handed; a caller's req must not come back
		// carrying payload, i18n or a data loader it never had.
		const req = { headers: new Headers() } as unknown as PayloadRequest
		const before = Object.keys(req)
		const { track } = setup({ scope: async () => 'alpha', timezone: async () => 'UTC' })
		await track(pageview, { req })
		expect(Object.keys(req)).toEqual(before)
	})

	it('honours an injected now', async () => {
		const now = new Date('2026-01-02T03:04:05.000Z')
		const { track, events } = setup()
		await track({ ...pageview, now })
		expect(events[0]?.timestamp).toEqual(now)
	})
})

describe('makeServerTrack write path', () => {
	it('buffers the event when the adapter runs a write buffer', async () => {
		const { track, events, drain } = setup()
		await track(pageview)
		expect(events).toHaveLength(1)
		expect(flushed).not.toHaveBeenCalled()
		expect(drain).not.toHaveBeenCalled()
	})

	it('drains the buffer before resolving when the caller asks it to', async () => {
		const { track, drain } = setup()
		await track(pageview, { flush: true })
		expect(drain).toHaveBeenCalledTimes(1)
	})

	it('flushes a single-event batch when there is no buffer', async () => {
		const { track, payload } = setup({}, false)
		await track(pageview)
		expect(flushed).toHaveBeenCalledTimes(1)
		expect(flushed.mock.calls[0]?.[0]).toBe(payload)
		expect(flushed.mock.calls[0]?.[1]).toHaveLength(1)
		expect(flushed.mock.calls[0]?.[1][0]?.path).toBe('/p')
	})
})

describe('trackServerEvent', () => {
	const runtimeWith = (adapters: AnalyticsAdapter[]): AnalyticsRuntime =>
		({
			registry: {
				get: () => adapters[0],
				default: () => adapters[0],
				all: () => adapters,
				isMultiProvider: () => false,
			},
		}) as unknown as AnalyticsRuntime

	const adapterWith = (track?: ServerTrack): AnalyticsAdapter =>
		({ ingest: { path: '/i', ...(track ? { track } : {}) } }) as unknown as AnalyticsAdapter

	it('delegates to the adapter that accepts server events', async () => {
		const track = vi.fn<ServerTrack>(async () => undefined)
		const payload = fakePayload()
		const req = fakeReq()
		setRuntime(payload, runtimeWith([adapterWith(track)]))
		await trackServerEvent(payload, pageview, { req })
		expect(track).toHaveBeenCalledWith(pageview, { req })
	})

	it('throws when no registered adapter accepts server events', async () => {
		const payload = fakePayload()
		setRuntime(payload, runtimeWith([adapterWith()]))
		await expect(trackServerEvent(payload, pageview)).rejects.toThrow(
			/needs the native adapter; provider-slot server tracking is not supported yet/
		)
	})

	it('throws when the plugin never installed a runtime', async () => {
		await expect(trackServerEvent(fakePayload(), pageview)).rejects.toThrow(AnalyticsTrackError)
	})
})
