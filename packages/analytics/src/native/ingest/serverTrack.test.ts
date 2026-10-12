import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../../core/contract'
import {
	AnalyticsTrackError,
	type ServerEventInput,
	type ServerTrack,
	type ServerTrackOptions,
} from '../../core/serverEvent'
import { openTransactionOf } from '../../db/openTransaction'
import type { Goal } from '../../goals/types'
import { type AnalyticsRuntime, setRuntime } from '../../plugin/runtime'
import { calendarDayOf } from '../../timeframe/calendar'
import { TimezoneResolutionError } from '../../timeframe/reportingTimezone'
import { type GeoResolver, noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { isOrderHitId, orderHitId } from '../store/ids'
import type { HitRow } from '../store/types'
import { SERVER_USER_AGENT } from './device'
import type { IngestAttribution, IngestResolvers } from './endpoint'
import { itemRefKey, itemRefSignature } from './itemSignature'
import type { ItemIngestOptions } from './normalizeEvent'
import { dedupeKeyFor, MAX_ORDER_ID_LENGTH } from './revenue'
import { makeServerTrack, type ServerTrackTarget, trackServerEvent } from './serverTrack'
import { dailyVisitorId } from './visitorHash'

const fakePayload = (sessions: Record<string, unknown> = {}): Payload =>
	({ db: { name: 'sqlite', sessions } }) as unknown as Payload

const fakeReq = (headers: Record<string, string> = {}): PayloadRequest =>
	({ headers: new Headers(headers) }) as unknown as PayloadRequest

/** The id a visitor gets on site `h` under the harness's salt. */
const visitorOf = (ip: string, ua: string): string =>
	dailyVisitorId({ ip, ua, site: 'h', salt: 'salt' })

interface Harness {
	/** The adapter's track, bound to the harness's own instance. */
	track: (event: ServerEventInput, opts?: ServerTrackOptions) => Promise<void>
	hits: HitRow[]
	/** The options each write was made with. */
	writes: Array<{ flush?: boolean } | undefined>
	/** The zone each salt was asked for, and the instant. */
	salted: Array<{ tz: string; at: Date }>
	/** Work the writer was asked to run later, and the check it waits on. */
	deferred: Array<{ work: () => Promise<void>; blocked: () => boolean }>
	payload: Payload
}

/** How the request behind an event is read, and where its hit is stored. */
interface Reading {
	geoResolver?: GeoResolver
	attribution?: IngestAttribution
	payload?: Payload
	items?: ItemIngestOptions
	sqlite?: boolean
	engine?: ServerTrackTarget['engine']
	siteHosts?: ServerTrackTarget['siteHosts']
}

const setup = (
	resolvers: IngestResolvers = {},
	{
		geoResolver = noopResolver,
		attribution = {},
		payload = fakePayload(),
		items,
		sqlite = false,
		engine,
		siteHosts,
	}: Reading = {}
): Harness => {
	const hits: HitRow[] = []
	const writes: Harness['writes'] = []
	const salted: Harness['salted'] = []
	const deferred: Harness['deferred'] = []
	const target: ServerTrackTarget = {
		salts: {
			forHit: async ({ at, zone }) => {
				const tz = await zone()
				salted.push({ tz, at })
				return { day: calendarDayOf(at, tz), tz, salt: 'salt' }
			},
			forDay: async () => 'salt',
		},
		writer: {
			// Every hit is kept, and answered as the store would: an id it already holds is a duplicate.
			write: async (hit, options) => {
				const repeated = hits.some((held) => held.id === hit.id)
				hits.push(hit)
				writes.push(options)
				return { written: repeated ? 0 : 1, duplicates: repeated ? 1 : 0 }
			},
			defer: (work, blocked) => {
				deferred.push({ work, blocked })
			},
		},
		...(items ? { items } : {}),
		...(engine ? { engine } : {}),
		...(siteHosts ? { siteHosts } : {}),
		sqlite,
	}
	const track = makeServerTrack({
		geoResolver,
		target: (owner) => {
			if (owner !== payload) {
				throw new Error('stored through another instance')
			}
			return target
		},
		getResolvers: () => resolvers,
		getAttribution: () => attribution,
	})
	return {
		hits,
		writes,
		salted,
		deferred,
		payload,
		track: (event, opts) => track(payload, event, opts),
	}
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'

const pageview: ServerEventInput = { type: 'pageview', path: '/p', hostname: 'h' }

describe('makeServerTrack attribution', () => {
	it('hashes the visitor from the given ip and user agent', async () => {
		const { track, hits } = setup()
		await track({ ...pageview, ip: '1.2.3.4', userAgent: 'curl/8' })
		expect(hits[0]?.v).toBe(visitorOf('1.2.3.4', 'curl/8'))
	})

	it('hashes without an ip when only a user agent is given', async () => {
		const { track, hits } = setup()
		await track({ ...pageview, userAgent: 'curl/8' })
		expect(hits[0]?.v).toBe(visitorOf('', 'curl/8'))
	})

	// No visitor is invented for code that names none: the hit counts, and belongs to nobody.
	it('never fabricates a visitor: an event with neither an ip nor an agent belongs to none', async () => {
		const { track, hits } = setup()
		await track(pageview)
		await track({ ...pageview, hostname: 'other.example' })
		expect(hits.map((hit) => hit.v)).toEqual(['', ''])
		expect(hits.every((hit) => hit.server)).toBe(true)
	})

	it('records the event without a location when the geo resolver throws, and says so', async () => {
		const warn = vi.fn()
		const payload = { ...fakePayload(), logger: { warn } } as unknown as Payload
		const throwing: GeoResolver = () => {
			throw new Error('geo service down')
		}
		const { track, hits } = setup({}, { geoResolver: throwing, payload })
		await track(pageview, { req: fakeReq({ 'x-real-ip': '9.9.9.9' }) })

		expect(hits).toHaveLength(1)
		expect(hits[0]?.country).toBeUndefined()
		expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
			expect.stringMatching(/geo resolver.*geo service down/),
		])
	})

	it('files an unattributed event under no device at all', async () => {
		const { track, hits } = setup()
		await track(pageview)
		expect(hits[0]?.device).toBeUndefined()
		expect(hits[0]?.browser).toBeUndefined()
		expect(hits[0]?.os).toBeUndefined()
	})

	it('extracts the utm keys from a query the caller passes, storing no query', async () => {
		const { track, hits } = setup()
		await track({ ...pageview, query: 'utm_source=newsletter&utm_medium=email&token=secret' })
		expect(hits[0]?.utmSource).toBe('newsletter')
		expect(hits[0]?.utmMedium).toBe('email')
		expect(JSON.stringify(hits[0])).not.toContain('secret')
	})

	it('classifies browser, os and language from the request it is given', async () => {
		const { track, hits } = setup()
		const req = fakeReq({
			'user-agent':
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
			'accept-language': 'de-DE,de;q=0.9',
		})
		await track(pageview, { req })
		expect(hits[0]?.browser).toBe('safari')
		expect(hits[0]?.os).toBe('ios')
		expect(hits[0]?.language).toBe('de-de')
	})

	it('inherits the whole header set of the request it is given, read under the trusted platform', async () => {
		const { track, hits } = setup(
			{},
			{ geoResolver: platformHeaderResolver, attribution: { trustedPlatform: 'vercel' } }
		)
		const req = fakeReq({
			'x-vercel-ip-country': 'US',
			'x-real-ip': '9.9.9.9',
			'x-forwarded-for': 'spoofed',
			'user-agent': IPHONE_UA,
		})
		await track(pageview, { req })
		expect(hits[0]?.country).toBe('US')
		expect(hits[0]?.device).toBe('mobile')
		expect(hits[0]?.v).toBe(visitorOf('9.9.9.9', IPHONE_UA))
	})

	it('reads no platform header while no platform is trusted', async () => {
		const { track, hits } = setup({}, { geoResolver: platformHeaderResolver })
		await track(pageview, { req: fakeReq({ 'cf-ipcountry': 'DE', 'x-vercel-ip-country': 'US' }) })
		expect(hits[0]?.country).toBeUndefined()
	})

	it('reads an explicit ip where the trusted platform would, and drops the platform location', async () => {
		const { track, hits } = setup(
			{},
			{ geoResolver: platformHeaderResolver, attribution: { trustedPlatform: 'cloudflare' } }
		)
		const req = fakeReq({
			'cf-connecting-ip': '5.5.5.5',
			'cf-ipcountry': 'DE',
			'user-agent': IPHONE_UA,
		})
		await track({ ...pageview, ip: '1.2.3.4' }, { req })
		expect(hits[0]?.v).toBe(visitorOf('1.2.3.4', IPHONE_UA))
		expect(hits[0]?.country).toBeUndefined()
	})

	it('reads an explicit ip behind any number of trusted proxies', async () => {
		const { track, hits } = setup({}, { attribution: { trustedProxyHops: 2 } })
		await track({ ...pageview, ip: '1.2.3.4', userAgent: 'curl/8' })
		expect(hits[0]?.v).toBe(visitorOf('1.2.3.4', 'curl/8'))
	})

	it('warns once about a forwarded chain nothing vouches for', async () => {
		const warn = vi.fn()
		const payload = { ...fakePayload(), logger: { warn } } as unknown as Payload
		const { track } = setup({}, { payload })
		const req = fakeReq({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1', 'user-agent': IPHONE_UA })
		await track(pageview, { req })
		await track(pageview, { req })
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]?.[0])).toMatch(/trustedProxyHops nor trustedPlatform/)
	})

	it('overlays an explicit ip and user agent over the request’s own', async () => {
		const { track, hits } = setup()
		const req = fakeReq({ 'x-forwarded-for': '9.9.9.9', 'user-agent': IPHONE_UA })
		await track({ ...pageview, ip: '1.2.3.4', userAgent: 'curl/8' }, { req })
		expect(hits[0]?.v).toBe(visitorOf('1.2.3.4', 'curl/8'))
	})

	it('hashes a request with an address but no agent under the server agent', async () => {
		const { track, hits } = setup()
		await track(pageview, { req: fakeReq({ 'x-forwarded-for': '9.9.9.9' }) })
		expect(hits[0]?.v).toBe(visitorOf('9.9.9.9', SERVER_USER_AGENT))
		expect(hits[0]?.device).toBeUndefined()
	})
})

describe('makeServerTrack identity', () => {
	const visitorReq = (): PayloadRequest =>
		fakeReq({
			'x-real-ip': '9.9.9.9',
			'x-vercel-ip-country': 'US',
			'x-vercel-ip-city': 'Boston',
			'user-agent': IPHONE_UA,
			'accept-language': 'de-DE,de;q=0.9',
		})
	const vercel: Reading = {
		geoResolver: platformHeaderResolver,
		attribution: { trustedPlatform: 'vercel' },
	}

	it("attributes the event to the request's visitor by default", async () => {
		const { track, hits } = setup({}, vercel)
		await track(pageview, { req: visitorReq() })
		expect(hits[0]?.v).toBe(visitorOf('9.9.9.9', IPHONE_UA))
		expect(hits[0]?.country).toBe('US')
	})

	it("records an event as no visitor's under 'none', reading nothing identifying off the request", async () => {
		const { track, hits } = setup({}, vercel)
		await track(pageview, { req: visitorReq(), identity: 'none' })
		expect(hits[0]?.v).toBe('')
		expect(hits[0]?.country).toBeUndefined()
		expect(hits[0]?.city).toBeUndefined()
		expect(hits[0]?.device).toBeUndefined()
		expect(hits[0]?.browser).toBeUndefined()
		expect(hits[0]?.os).toBeUndefined()
		expect(hits[0]?.language).toBeUndefined()
	})

	it("ignores an explicit ip and user agent under 'none'", async () => {
		const { track, hits } = setup()
		await track({ ...pageview, ip: '1.2.3.4', userAgent: IPHONE_UA }, { identity: 'none' })
		expect(hits[0]?.v).toBe('')
		expect(hits[0]?.device).toBeUndefined()
	})

	it("still resolves the scope, goals and timezone from the request under 'none'", async () => {
		const signup: Goal[] = [
			{ slug: 'signup', name: 'Signup', match: { kind: 'event', name: 'signup' } },
		]
		const goals = vi.fn(async (_req: PayloadRequest, _scope?: string | null) => signup)
		const { track, hits, salted } = setup({
			scope: async () => 'tenant-a',
			goals,
			timezone: async () => 'Europe/Berlin',
		})
		await track(
			{ type: 'event', name: 'signup', path: '/p', hostname: 'h' },
			{ req: visitorReq(), identity: 'none' }
		)
		expect(hits[0]?.scope).toBe('tenant-a')
		expect(hits[0]?.conversions).toBe(1)
		expect(goals.mock.calls[0]?.[1]).toBe('tenant-a')
		expect(salted[0]?.tz).toBe('Europe/Berlin')
		expect(hits[0]?.v).toBe('')
	})

	it("says nothing about an unvouched forwarded chain it does not read under 'none'", async () => {
		const warn = vi.fn()
		const payload = { ...fakePayload(), logger: { warn } } as unknown as Payload
		const { track } = setup({}, { payload })
		const req = fakeReq({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1', 'user-agent': IPHONE_UA })
		await track(pageview, { req, identity: 'none' })
		expect(warn).not.toHaveBeenCalled()
	})

	/** An install whose native beacon fills the global slot, which `gate` holds or not. */
	const gatedInstall = (gate: AnalyticsRuntime['captureGate']) => {
		const warn = vi.fn()
		const payload = { ...fakePayload(), logger: { warn } } as unknown as Payload
		const native = {
			id: 'native',
			ingest: { path: '/i', track: async () => undefined },
			capture: { client: { kind: 'native' } },
		} as unknown as AnalyticsAdapter
		setRuntime(payload, {
			registry: { all: () => [native], get: () => native, default: () => native },
			captureGate: gate,
		} as unknown as AnalyticsRuntime)
		return { ...setup({}, { ...vercel, payload }), warn }
	}

	// The server cannot know the visitor's answer, and a refusing visitor's request must not count.
	it("records no visitor by default while capture.gate holds the native slot, and the request's under 'request'", async () => {
		const { track, hits, warn } = gatedInstall(() => true)
		await track(pageview, { req: visitorReq() })
		await track({ ...pageview, ip: '1.2.3.4', userAgent: IPHONE_UA }, { req: visitorReq() })
		await track(pageview, { req: visitorReq(), identity: 'request' })

		expect(hits.map((hit) => hit.v)).toEqual(['', '', visitorOf('9.9.9.9', IPHONE_UA)])
		expect(hits[0]?.country).toBeUndefined()
		expect(hits[0]?.device).toBeUndefined()
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]?.[0])).toContain("identity: 'request'")
	})

	it('attributes the request by default when capture.gate holds nothing native fills', async () => {
		const { track, hits } = gatedInstall(({ slot }) => slot === 'tenant')
		await track(pageview, { req: visitorReq() })
		expect(hits[0]?.v).toBe(visitorOf('9.9.9.9', IPHONE_UA))
	})

	it('refuses an identity it does not know, writing nothing', async () => {
		const { track, hits } = setup()
		const opts = { identity: 'None' } as unknown as ServerTrackOptions
		await expect(track(pageview, opts)).rejects.toThrow(AnalyticsTrackError)
		await expect(track(pageview, opts)).rejects.toThrow(/identity must be 'request' or 'none'/)
		expect(hits).toHaveLength(0)
	})
})

describe('makeServerTrack validation', () => {
	it('throws AnalyticsTrackError naming the missing field', async () => {
		const { track, hits } = setup()
		await expect(
			track({ type: 'goal', path: '/p', hostname: 'h' } as ServerEventInput)
		).rejects.toThrow(/name/)
		await expect(track({ ...pageview, path: '' })).rejects.toThrow(/path/)
		await expect(track({ ...pageview, hostname: '' })).rejects.toThrow(/hostname/)
		expect(hits).toEqual([])
	})

	it('throws rather than dropping, with the error named for a catch block', async () => {
		const { track } = setup()
		const err = await track({ ...pageview, path: '' }).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(AnalyticsTrackError)
		expect((err as Error).name).toBe('AnalyticsTrackError')
	})

	it('writes through the instance it is handed, with no instance of its own to wait for', async () => {
		const worker = fakePayload()
		const { track, hits } = setup({}, { payload: worker })
		await track(pageview)
		expect(hits).toHaveLength(1)
	})
})

describe('makeServerTrack scope', () => {
	const scoped: IngestResolvers = { scope: async () => 'from-req' }

	it('stamps an explicit scope over the request', async () => {
		const { track, hits } = setup(scoped)
		await track({ ...pageview, scope: 'alpha' }, { req: fakeReq() })
		expect(hits[0]?.scope).toBe('alpha')
	})

	it('reads an explicit null as install-wide', async () => {
		const { track, hits } = setup(scoped)
		await track({ ...pageview, scope: null }, { req: fakeReq() })
		expect(hits[0]?.scope).toBe('')
	})

	it('resolves the scope from the request when none is given', async () => {
		const { track, hits } = setup(scoped)
		await track(pageview, { req: fakeReq() })
		expect(hits[0]?.scope).toBe('from-req')
	})

	it('is install-wide when neither a scope nor a request is given', async () => {
		const { track, hits } = setup(scoped)
		await track(pageview)
		expect(hits[0]?.scope).toBe('')
	})

	it('stores a scope the caller names as the install-wide one in an unscoped install', async () => {
		const { track, hits } = setup()
		await track({ ...pageview, scope: 'alpha' })
		expect(hits[0]?.scope).toBe('')
	})
})

describe('makeServerTrack resolvers', () => {
	it('resolves goals under the scope the event is stamped with', async () => {
		const goals: Goal[] = [
			{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
		]
		const resolveGoals = vi.fn(async (_req: PayloadRequest, _scope?: string | null) => goals)
		const { track, hits } = setup({ scope: async () => 'alpha', goals: resolveGoals })
		await track({ ...pageview, path: '/thank-you' }, { req: fakeReq() })
		expect(resolveGoals.mock.calls[0]?.[1]).toBe('alpha')
		expect(hits[0]?.goals).toEqual([{ slug: 'thanks', value: 0 }])
	})

	it("salts the visitor with the day of the scope's own timezone", async () => {
		const timezone = vi.fn(async (_req: PayloadRequest, _scope?: string | null) => 'Europe/Berlin')
		const { track, salted } = setup({ scope: async () => 'alpha', timezone })
		await track(pageview, { req: fakeReq() })
		expect(salted.map((salt) => salt.tz)).toEqual(['Europe/Berlin'])
		expect(timezone.mock.calls[0]?.[1]).toBe('alpha')
	})

	it("records the event, hashed by the UTC day, while the scope's timezone has never resolved", async () => {
		const warn = vi.fn()
		const payload = { ...fakePayload(), logger: { warn } } as unknown as Payload
		const { track, hits } = setup(
			{
				timezone: async () => {
					throw new TimezoneResolutionError('analytics: reportingTimezone resolution failed')
				},
			},
			{ payload }
		)
		await track(pageview, { req: fakeReq() })
		await track(pageview, { req: fakeReq() })
		expect(hits).toHaveLength(2)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(String(warn.mock.calls[0]?.[0])).toMatch(/UTC day.*reportingTimezone has never resolved/)
	})

	it('prefers an explicit timezone over the resolver', async () => {
		const timezone = vi.fn(async () => 'Europe/Berlin')
		const { track, salted } = setup({ timezone })
		await track({ ...pageview, timezone: 'UTC' }, { req: fakeReq() })
		expect(salted.map((salt) => salt.tz)).toEqual(['UTC'])
		expect(timezone).not.toHaveBeenCalled()
	})

	it('sanitizes optional fields exactly as a browser event is sanitized', async () => {
		const { track, hits } = setup()
		await track({
			...pageview,
			type: 'goal',
			name: 'purchase',
			value: 30,
			currency: 'euro',
			props: { plan: 'pro', nested: { no: true } },
		} as ServerEventInput)
		expect(hits[0]).toMatchObject({ value: 30, props: { plan: 'pro' } })
		expect(hits[0]?.currency).toBeUndefined()
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

	it('honours an injected now, and salts the visitor with its day', async () => {
		const now = new Date('2026-01-02T03:04:05.000Z')
		const { track, hits, salted } = setup()
		await track({ ...pageview, now })
		expect(hits[0]?.ts).toEqual(now)
		expect(salted[0]?.at).toEqual(now)
	})

	it('keeps the lines of a sale, stored under props beside the props that were sent', async () => {
		const { track, hits } = setup()
		await track({
			type: 'goal',
			name: 'purchase',
			path: '/orders',
			hostname: 'h',
			value: 30,
			props: { plan: 'pro' },
			items: [{ id: 'sku-1', quantity: 2, price: 15 }, { name: 'no id' }],
		})
		expect(hits[0]?.props).toEqual({
			plan: 'pro',
			items: [{ id: 'sku-1', quantity: 2, price: 15 }],
		})
	})
})

describe('makeServerTrack content items', () => {
	const key = itemRefKey('test-secret')
	const withItems = () =>
		setup({}, { items: { collections: new Set(['offers']), signature: { mode: 'required', key } } })

	it('keeps the item of a server event whose collection is bound as items', async () => {
		const { track, hits } = withItems()
		await track({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', item: 'offers:7' })
		expect(hits[0]?.item).toBe('offers:7')
	})

	// Aggregation leaves server hits out of an item's pages: a server path is no page it was seen on.
	it('marks the hit as server code’s, which keeps it off the pages an item was seen on', async () => {
		const { track, hits } = withItems()
		await track({
			type: 'goal',
			name: 'purchase',
			path: '/orders',
			hostname: 'h',
			item: 'offers:7',
		})
		expect(hits[0]).toMatchObject({ server: true, item: 'offers:7', path: '/orders' })
	})

	it('drops any other item, as the endpoint does, and keeps the event', async () => {
		const { track, hits } = withItems()
		await track({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', item: 'users:7' })
		expect(hits[0]?.type).toBe('goal')
		expect(hits[0]?.item).toBeUndefined()
	})

	it('keeps no item on an install that binds none', async () => {
		const { track, hits } = setup()
		await track({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', item: 'offers:7' })
		expect(hits[0]?.item).toBeUndefined()
	})

	it('trusts its own unsigned item even where pages must sign theirs', async () => {
		const { track, hits } = withItems()
		await track({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', item: 'offers:7' })
		expect(hits[0]?.item).toBe('offers:7')
	})

	it('keeps a signed item it relays under its bare ref, and drops a tampered one', async () => {
		const { track, hits } = withItems()
		const signed = `offers:7@${itemRefSignature(key, 'offers:7')}`
		await track({ type: 'goal', name: 'purchase', path: '/p', hostname: 'h', item: signed })
		await track({
			type: 'goal',
			name: 'purchase',
			path: '/p',
			hostname: 'h',
			item: `offers:8@${itemRefSignature(key, 'offers:7')}`,
		})
		expect(hits[0]?.item).toBe('offers:7')
		expect(hits[1]?.type).toBe('goal')
		expect(hits[1]?.item).toBeUndefined()
	})
})

describe('makeServerTrack revenue that completes nothing', () => {
	const sale = (orderId: string, goal: string): ServerEventInput => ({
		type: 'goal',
		name: goal,
		path: '/orders',
		hostname: 'h',
		value: 20,
		revenue: true,
		orderId,
	})

	const withLogger = (resolvers: IngestResolvers) => {
		const warn = vi.fn()
		const payload = { ...fakePayload(), logger: { warn } } as unknown as Payload
		return { ...setup(resolvers, { payload }), warn }
	}

	it('still records the event, and warns once per slug', async () => {
		const { hits, track, warn } = withLogger({ goals: async () => [] })
		await track(sale('o-1', 'subscription'), { req: fakeReq() })
		await track(sale('o-2', 'subscription'), { req: fakeReq() })
		expect(hits).toHaveLength(2)
		// The money is on the row; it is the conversion and the revenue that are missing.
		expect(hits[0]?.value).toBe(20)
		expect(hits[0]?.goals).toBeUndefined()
		expect(hits[0]?.conversions).toBeUndefined()
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toContain('subscription')
	})

	it('says nothing when the slug does match a goal', async () => {
		const goals: Goal[] = [{ slug: 'renewal', name: 'Renewal', match: { kind: 'goal' } }]
		const { hits, track, warn } = withLogger({ goals: async () => goals })
		await track(sale('o-3', 'renewal'), { req: fakeReq() })
		expect(hits[0]?.goals).toEqual([{ slug: 'renewal', value: 20 }])
		expect(hits[0]).toMatchObject({ conversions: 1, revenue: 20 })
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('makeServerTrack write path', () => {
	it('hands the hit to the writer, which decides whether it waits in a buffer', async () => {
		const { track, hits, writes } = setup()
		await track(pageview)
		expect(hits).toHaveLength(1)
		expect(writes).toEqual([{}])
	})

	it('asks the writer to store it at once when the caller asks to know it landed', async () => {
		const { track, writes } = setup()
		await track(pageview, { flush: true })
		expect(writes).toEqual([{ flush: true }])
	})

	it('keys an order by its dedupe key, the same for every retry', async () => {
		const { track, hits } = setup()
		const order: ServerEventInput = { ...pageview, type: 'goal', name: 'purchase', orderId: 'o-1' }
		await track(order)
		await track({ ...order, now: new Date('2026-02-01T00:00:00.000Z') })
		expect(hits.map((hit) => isOrderHitId(hit.id))).toEqual([true, true])
		expect(hits[1]?.id).toBe(hits[0]?.id)
		expect(hits[0]?.id).toMatch(/^os\.[0-9a-f]{64}$/)
	})

	it('asks the engine, after the write, to set aside the browser record of the same sale', async () => {
		const steps: string[] = []
		const stored = vi.fn(async (_scope: string, _id: string) => {
			steps.push(`settled after ${hits.length} hit`)
		})
		const { track, hits } = setup(
			{},
			{
				engine: {
					serverHitDay: async () => ({ scope: '', day: 20261007, tz: 'UTC', closed: false }),
					reopen: async () => undefined,
					orderStored: stored,
					saleAttribution: async () => ({}),
				},
			}
		)
		const sale: ServerEventInput = {
			type: 'goal',
			name: 'purchase',
			path: '/orders',
			hostname: 'h',
			value: 20,
			revenue: true,
			orderId: 'o-1',
		}
		await track(sale)
		await track(pageview)
		await track({ ...sale, value: -5, refundId: 'r-1' })
		expect(stored).toHaveBeenCalledOnce()
		expect(stored).toHaveBeenCalledWith('', hits[0]?.id)
		expect(steps).toEqual(['settled after 1 hit'])
	})
})

describe('makeServerTrack refunds', () => {
	const refund = (refundId?: string, value = -20): ServerEventInput => ({
		type: 'goal',
		name: 'purchase',
		path: '/orders',
		hostname: 'h',
		value,
		revenue: true,
		orderId: 'o-1',
		...(refundId === undefined ? {} : { refundId }),
	})
	const goals: Goal[] = [{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }]

	it('refuses a refund of an order without its own refund id, writing nothing', async () => {
		const { track, hits } = setup({ goals: async () => goals })
		await expect(track(refund(), { req: fakeReq() })).rejects.toThrow(/refundId/)
		await expect(track(refund(' '), { req: fakeReq() })).rejects.toBeInstanceOf(AnalyticsTrackError)
		await expect(
			track(refund('x'.repeat(MAX_ORDER_ID_LENGTH + 1)), { req: fakeReq() })
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(hits).toEqual([])
	})

	it('counts the refund in revenue and as no conversion', async () => {
		const { track, hits } = setup({ goals: async () => goals })
		await track(refund('r-1'), { req: fakeReq() })
		expect(hits[0]).toMatchObject({ conversions: 0, revenue: -20, value: -20 })
		expect(hits[0]?.goals).toEqual([{ slug: 'purchase', value: -20 }])
	})

	it('keys each refund of an order by its own id, and a retry by the same one', async () => {
		const { track, hits } = setup({ goals: async () => goals })
		await track(refund('r-1'), { req: fakeReq() })
		await track(refund('r-2', -5), { req: fakeReq() })
		await track(refund('r-1'), { req: fakeReq() })
		const [first, second, retry] = hits.map((hit) => hit.id)
		expect(first).not.toBe(second)
		expect(retry).toBe(first)
	})

	it('needs no refund id where there is no order to key it by', async () => {
		const { track, hits } = setup({ goals: async () => goals })
		const { orderId: _orderId, ...anonymous } = refund()
		await track(anonymous, { req: fakeReq() })
		expect(hits[0]).toMatchObject({ conversions: 0, revenue: -20 })
		expect(isOrderHitId(hits[0]?.id ?? '')).toBe(false)
	})

	it("files a refund with no visitor of its own where its sale counts, asking for that sale's two records", async () => {
		const asked: Array<[string, { wire: string; server: string }]> = []
		const { track, hits } = setup(
			{ goals: async () => goals },
			{
				engine: {
					serverHitDay: async () => ({ scope: '', day: 20261007, tz: 'UTC', closed: false }),
					reopen: async () => undefined,
					orderStored: async () => undefined,
					saleAttribution: async (scope, sale) => {
						asked.push([scope, sale])
						return { channel: 'email', source: 'news', country: 'DE', channelVersion: 2 }
					},
				},
			}
		)
		await track(refund('r-1'), { req: fakeReq() })
		await track(refund('r-2'), { req: fakeReq({ 'user-agent': IPHONE_UA }) })
		const keyOf = (origin: 'wire' | 'server') =>
			orderHitId(dedupeKeyFor({ origin, goal: 'purchase', orderId: 'o-1' }))
		expect(asked).toEqual([['', { wire: keyOf('wire'), server: keyOf('server') }]])
		expect(hits[0]).toMatchObject({ v: '', channel: 'email', source: 'news', country: 'DE' })
		expect(hits[1]?.v).not.toBe('')
		expect(hits[1]?.channel).not.toBe('email')
	})
})

describe('makeServerTrack orders', () => {
	const sale = (orderId: string): ServerEventInput => ({
		type: 'goal',
		name: 'purchase',
		path: '/orders',
		hostname: 'h',
		value: 20,
		revenue: true,
		orderId,
	})

	it('refuses an order id no key can be stored under, and keys a long provider id', async () => {
		const { track, hits } = setup()
		for (const orderId of ['x'.repeat(MAX_ORDER_ID_LENGTH + 1), 'o\u00001', '']) {
			await expect(track(sale(orderId))).rejects.toThrow(/valid "orderId"/)
		}
		expect(hits).toEqual([])
		const stripe = 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u'
		await track(sale(stripe))
		expect(hits[0]?.id).toBe(
			orderHitId(dedupeKeyFor({ origin: 'server', goal: 'purchase', orderId: stripe }))
		)
	})

	it('counts no day again for a retried order, which stores nothing', async () => {
		const reopen = vi.fn(async () => undefined)
		const orderStored = vi.fn(async () => undefined)
		const { track } = setup(
			{},
			{
				engine: {
					serverHitDay: async () => ({ scope: '', day: 20261003, tz: 'UTC', closed: true }),
					reopen,
					orderStored,
					saleAttribution: async () => ({}),
				},
			}
		)
		await track(sale('o-9'))
		await track(sale('o-9'))
		expect(reopen).toHaveBeenCalledTimes(1)
		expect(orderStored).toHaveBeenCalledTimes(1)
	})

	it('warns once that a scoped sale with neither scope nor req is filed under no tenant', async () => {
		const warn = vi.fn()
		const payload = { db: { name: 'sqlite', sessions: {} }, logger: { warn } } as unknown as Payload
		const { track, hits } = setup({ scope: async () => 'tenant-a' }, { payload })
		await track(sale('o-1'))
		await track(sale('o-2'))
		await track({ ...sale('o-3'), scope: 'tenant-a' })
		await track(sale('o-4'), { req: fakeReq() })
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/neither scope nor req/)
		expect(hits.map((hit) => hit.scope)).toEqual(['', '', 'tenant-a', 'tenant-a'])
	})
})

describe('makeServerTrack time', () => {
	const MINUTE = 60_000

	it('refuses a time more than five minutes ahead of the server clock, and an invalid one', async () => {
		const { track, hits } = setup()
		await expect(
			track({ ...pageview, now: new Date(Date.now() + 10 * MINUTE) })
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		await expect(track({ ...pageview, now: new Date(Number.NaN) })).rejects.toThrow(/valid "now"/)
		expect(hits).toEqual([])
		await track({ ...pageview, now: new Date(Date.now() + MINUTE) })
		expect(hits).toHaveLength(1)
	})

	it('refuses, before writing, a time its engine says its raw hits may no longer hold', async () => {
		const { track, hits } = setup(
			{},
			{
				engine: {
					serverHitDay: async () => {
						throw new AnalyticsTrackError('analytics: at or before the raw floor day')
					},
					reopen: async () => undefined,
					orderStored: async () => undefined,
					saleAttribution: async () => ({}),
				},
			}
		)
		await expect(track({ ...pageview, now: new Date('2026-01-01T00:00:00.000Z') })).rejects.toThrow(
			/raw floor day/
		)
		expect(hits).toEqual([])
	})

	it('stores a hit on a closed day at once, then reopens that day for the next count', async () => {
		const steps: string[] = []
		const reopened: unknown[] = []
		const day = { scope: '', day: 20261003, tz: 'UTC', closed: true }
		const { track, writes, hits } = setup(
			{},
			{
				engine: {
					serverHitDay: async () => day,
					reopen: async (target) => {
						steps.push(`reopen after ${hits.length} hit`)
						reopened.push(target)
					},
					orderStored: async () => undefined,
					saleAttribution: async () => ({}),
				},
			}
		)
		await track({ ...pageview, now: new Date('2026-10-03T10:00:00.000Z') })
		expect(writes).toEqual([{ flush: true }])
		expect(steps).toEqual(['reopen after 1 hit'])
		expect(reopened).toEqual([day])
	})

	it('leaves a day still running as it is', async () => {
		const reopen = vi.fn(async () => undefined)
		const { track, writes } = setup(
			{},
			{
				engine: {
					serverHitDay: async () => ({ scope: '', day: 20261007, tz: 'UTC', closed: false }),
					reopen,
					orderStored: async () => undefined,
					saleAttribution: async () => ({}),
				},
			}
		)
		await track(pageview)
		expect(writes).toEqual([{}])
		expect(reopen).not.toHaveBeenCalled()
	})
})

describe('makeServerTrack referrers', () => {
	it('reads a referrer on another hostname of the scope as the site’s own: no landing, no ref', async () => {
		const asked: string[] = []
		const seen: string[] = []
		const { track, hits } = setup(
			{},
			{
				siteHosts: {
					of: async (scope) => {
						asked.push(scope)
						return new Set(['shop.example'])
					},
					saw: (_scope, hostname) => {
						seen.push(hostname)
					},
				},
			}
		)
		await track({ ...pageview, referrer: 'https://www.shop.example/cart' })
		await track({ ...pageview, referrer: 'https://news.example/story' })
		await track({ ...pageview, referrer: 'https://www.shop.example/cart', userAgent: IPHONE_UA })
		// With no visitor and nothing saying where it came from, a hit claims no source at all.
		expect(hits.map((hit) => [hit.landing, hit.ref, hit.source])).toEqual([
			[false, undefined, undefined],
			[true, 'news.example', 'news.example'],
			[false, undefined, 'direct'],
		])
		expect(asked).toEqual(['', '', ''])
		expect(seen).toEqual(['h', 'h', 'h'])
	})
})

describe('makeServerTrack inside a host transaction', () => {
	const inTransaction = (id: string | Promise<string>): PayloadRequest =>
		({ headers: new Headers(), transactionID: id }) as unknown as PayloadRequest

	// SQLite has one writer, and the host holds it until its transaction ends: a write here would
	// wait on the very caller it is part of.
	it('on SQLite, resolves at once and records the event once the transaction ends', async () => {
		const sessions: Record<string, unknown> = { 'tx-1': {} }
		const { track, hits, deferred } = setup({}, { payload: fakePayload(sessions), sqlite: true })
		await track(pageview, { req: inTransaction('tx-1'), flush: true })
		expect(hits).toEqual([])
		expect(deferred).toHaveLength(1)
		expect(deferred[0]?.blocked()).toBe(true)
		delete sessions['tx-1']
		expect(deferred[0]?.blocked()).toBe(false)
		await deferred[0]?.work()
		expect(hits).toHaveLength(1)
		expect(hits[0]?.path).toBe('/p')
	})

	it('on SQLite, writes at once for a request whose transaction already ended, or never began', async () => {
		const { track, hits, deferred } = setup({}, { payload: fakePayload({}), sqlite: true })
		await track(pageview, { req: inTransaction('tx-gone') })
		await track(pageview, { req: fakeReq() })
		expect(deferred).toEqual([])
		expect(hits).toHaveLength(2)
	})

	it('on Postgres and Mongo, writes at once outside the transaction the host holds', async () => {
		const { track, hits, deferred } = setup({}, { payload: fakePayload({ 'tx-1': {} }) })
		await track(pageview, { req: inTransaction('tx-1') })
		expect(deferred).toEqual([])
		expect(hits).toHaveLength(1)
	})

	it('reads a transaction id handed over as a promise', async () => {
		const payload = fakePayload({ 'tx-2': {} })
		const open = await openTransactionOf(payload, inTransaction(Promise.resolve('tx-2')))
		expect(open?.()).toBe(true)
		expect(await openTransactionOf(payload, fakeReq())).toBeUndefined()
		expect(await openTransactionOf(payload, undefined)).toBeUndefined()
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
		expect(track).toHaveBeenCalledWith(payload, pageview, { req })
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
