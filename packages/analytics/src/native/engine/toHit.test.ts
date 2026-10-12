import { describe, expect, it } from 'vitest'
import { MAX_ITEMS_PER_BEACON } from '../../goals/constants'
import { HOUR_MS } from '../../timeframe/tz'
import { noopResolver } from '../geo/geoResolver'
import { SERVER_USER_AGENT } from '../ingest/device'
import {
	eventTime,
	type NormalizedEvent,
	normalizeEvent,
	type RawEventInput,
} from '../ingest/normalizeEvent'
import { CHANNEL_TAXONOMY_VERSION } from '../ingest/source'
import { createUlidFactory, orderHitId, ULID_LENGTH, ulidTime } from '../store/ids'
import { isLanding, toHit } from './toHit'

const RECEIVED = new Date('2026-10-06T09:30:00.000Z')

/** Ids from a fixed random source, so a test can name the one a hit gets. */
const ids = () => createUlidFactory((size) => new Uint8Array(size))

/** What normalizeEvent makes of a landing pageview from a search engine, by hand. */
const stored = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
	timestamp: RECEIVED,
	type: 'pageview',
	path: '/pricing',
	hostname: 'shop.example',
	referrer: 'https://www.google.com/',
	referrerHost: 'google.com',
	device: 'desktop',
	browser: 'chrome',
	os: 'macos',
	country: 'DE',
	region: 'BE',
	city: 'Berlin',
	language: 'de-de',
	visitorId: 'AbCdEfGhIjKlMnOp',
	scrollDepth: 0,
	...overrides,
})

const hitOf = (event: NormalizedEvent) => toHit(event, { receivedAt: RECEIVED, ids: ids() })

/** An engagement as ingest builds it: filed `sinceMs` before it arrived, by the one rule. */
const engagementSent = (
	sinceMs: unknown,
	overrides: Partial<NormalizedEvent> = {}
): NormalizedEvent => {
	const raw: Pick<RawEventInput, 'type' | 'sinceMs'> = { type: 'engagement' }
	Reflect.set(raw, 'sinceMs', sinceMs)
	return stored({
		type: 'engagement',
		timestamp: eventTime(raw, RECEIVED),
		durationMs: 4000,
		scrollDepth: 30,
		...overrides,
	})
}

describe('toHit', () => {
	it('stores a landing pageview with every field it carries, and no others', () => {
		const hit = hitOf(
			stored({
				utmSource: 'spring',
				utmMedium: 'email',
				utmCampaign: 'launch',
				utmContent: 'hero',
				utmTerm: 'boots',
				clickId: 'gclid',
				props: { plan: 'pro' },
				scope: 'tenant-a',
			})
		)
		expect(hit).toEqual({
			id: ids()(RECEIVED),
			scope: 'tenant-a',
			ts: RECEIVED,
			type: 'pageview',
			hostname: 'shop.example',
			path: '/pricing',
			v: 'AbCdEfGhIjKlMnOp',
			landing: true,
			server: false,
			ref: 'google.com',
			source: 'spring',
			channel: 'email',
			channelVersion: CHANNEL_TAXONOMY_VERSION,
			clickId: 'gclid',
			utmSource: 'spring',
			utmMedium: 'email',
			utmCampaign: 'launch',
			utmContent: 'hero',
			utmTerm: 'boots',
			country: 'DE',
			region: 'BE',
			city: 'Berlin',
			language: 'de-de',
			device: 'desktop',
			browser: 'chrome',
			os: 'macos',
			scrollDepth: 0,
			props: { plan: 'pro' },
		})
		expect(hit.id).toHaveLength(ULID_LENGTH)
		expect(ulidTime(hit.id)).toBe(RECEIVED.getTime())
		expect(hit).not.toHaveProperty('referrer')
		expect(hit).not.toHaveProperty('visitorHash')
		expect(hit).not.toHaveProperty('sessionId')
	})

	it('leaves out what a hit does not carry, rather than keeping it undefined', () => {
		const hit = hitOf(stored({ type: 'event', name: 'signup', navigation: true }))
		expect(Object.values(hit)).not.toContain(undefined)
		expect(Object.keys(hit)).not.toContain('ref')
		expect(Object.keys(hit)).not.toContain('currency')
	})

	it('stores no scope as the empty one, and a visitor-less event as no visitor', () => {
		const hit = hitOf(stored({ visitorId: '' }))
		expect(hit.scope).toBe('')
		expect(hit.v).toBe('')
		expect(hitOf(stored({ visitorId: undefined })).v).toBe('')
	})

	it('claims no source for a visitor-less event that carries none, and keeps one it carries', () => {
		const bare = hitOf(
			stored({
				type: 'goal',
				name: 'purchase',
				visitorId: '',
				referrer: undefined,
				referrerHost: undefined,
			})
		)
		for (const field of ['source', 'channel', 'channelVersion', 'ref'] as const) {
			expect(bare).not.toHaveProperty(field)
		}
		const tagged = hitOf(
			stored({
				type: 'goal',
				name: 'purchase',
				visitorId: '',
				referrer: undefined,
				referrerHost: undefined,
				utmSource: 'news',
				utmMedium: 'email',
			})
		)
		expect(tagged).toMatchObject({ source: 'news', channel: 'email', utmSource: 'news' })
	})
})

describe('toHit landing', () => {
	it('opens a visit for a pageview with no referrer, as direct', () => {
		const hit = hitOf(stored({ referrer: undefined, referrerHost: undefined }))
		expect(hit).toMatchObject({ landing: true, source: 'direct', channel: 'direct' })
		expect(hit.ref).toBeUndefined()
	})

	it('opens a visit for a pageview another site linked to, and keeps that site as its host alone', () => {
		const hit = hitOf(stored())
		expect(hit).toMatchObject({
			landing: true,
			ref: 'google.com',
			source: 'google.com',
			channel: 'organic-search',
		})
	})

	it('opens none for a pageview a page of the same site linked to', () => {
		const hit = hitOf(
			stored({ referrer: 'https://WWW.shop.example/cart', referrerHost: undefined })
		)
		expect(hit).toMatchObject({ landing: false, source: 'direct', channel: 'direct' })
		expect(hit.ref).toBeUndefined()
	})

	// A single-page app keeps the referrer its document was loaded with on every later page.
	it("opens none for a single-page app's navigation, and leaves the old referrer out", () => {
		const hit = hitOf(stored({ navigation: true }))
		expect(hit).toMatchObject({ landing: false, source: 'direct', channel: 'direct' })
		expect(hit.ref).toBeUndefined()
	})

	it('still reads the campaign and the click id a non-landing hit carries itself', () => {
		const tagged = hitOf(stored({ navigation: true, utmSource: 'Spring', utmMedium: 'email' }))
		expect(tagged).toMatchObject({ source: 'spring', channel: 'email', utmSource: 'Spring' })
		const clicked = hitOf(stored({ navigation: true, clickId: 'gclid' }))
		expect(clicked).toMatchObject({ source: 'direct', channel: 'paid-search', clickId: 'gclid' })
	})

	it('never opens a visit with an event, a goal or an engagement, whatever their referrer', () => {
		for (const type of ['event', 'goal', 'engagement'] as const) {
			const hit = hitOf(stored({ type, name: type === 'engagement' ? undefined : 'signup' }))
			expect(hit.landing).toBe(false)
			expect(hit.ref).toBeUndefined()
		}
		const click = hitOf(stored({ type: 'event', name: 'signup' }))
		expect(click).toMatchObject({ source: 'direct', channel: 'direct', name: 'signup' })
	})

	it('opens a visit for a pageview recorded on the server like for one a browser sent', () => {
		const pageview = hitOf(stored({ server: true }))
		const goal = hitOf(stored({ server: true, type: 'goal', name: 'signup' }))
		expect(pageview).toMatchObject({ server: true, landing: true, ref: 'google.com' })
		expect(goal).toMatchObject({ server: true, landing: false })
	})

	it('decides the same as isLanding', () => {
		expect(isLanding({ type: 'pageview', hostname: 'a.example' })).toBe(true)
		expect(isLanding({ type: 'pageview', hostname: 'a.example', navigation: true })).toBe(false)
		expect(
			isLanding({ type: 'pageview', hostname: 'a.example', referrer: 'https://a.example/x' })
		).toBe(false)
		expect(isLanding({ type: 'goal', hostname: 'a.example' })).toBe(false)
		expect(
			isLanding({
				type: 'pageview',
				hostname: 'a.example',
				referrer: 'https://b.example/x',
				siteReferrer: true,
			})
		).toBe(false)
	})
})

describe('toHit engagement', () => {
	it("files an engagement at its pageview's time, and ends its reading where it arrived", () => {
		const hit = hitOf(engagementSent(90_000, { impressions: ['offers:1', 'offers:2'] }))
		expect(hit).toEqual({
			id: ids()(new Date(RECEIVED.getTime() - 90_000)),
			scope: '',
			ts: new Date(RECEIVED.getTime() - 90_000),
			lastAt: RECEIVED,
			type: 'engagement',
			hostname: 'shop.example',
			path: '/pricing',
			v: 'AbCdEfGhIjKlMnOp',
			landing: false,
			server: false,
			durationMs: 4000,
			scrollDepth: 30,
			impressions: ['offers:1', 'offers:2'],
		})
	})

	it('believes sinceMs from zero up to a day, and files anything else when it arrived', () => {
		expect(hitOf(engagementSent(0)).ts).toEqual(RECEIVED)
		expect(hitOf(engagementSent(24 * HOUR_MS)).ts).toEqual(
			new Date(RECEIVED.getTime() - 24 * HOUR_MS)
		)
		for (const sinceMs of [-1, 24 * HOUR_MS + 1, Number.NaN, '90000', undefined]) {
			const hit = hitOf(engagementSent(sinceMs))
			expect(hit.ts).toEqual(RECEIVED)
			expect(hit.lastAt).toEqual(RECEIVED)
		}
	})

	it('never ends the reading before it started', () => {
		const hit = toHit(engagementSent(0, { timestamp: new Date(RECEIVED.getTime() + 5000) }), {
			receivedAt: RECEIVED,
		})
		expect(hit.lastAt).toEqual(hit.ts)
	})

	it("carries nothing about the visitor, whose pageview's row holds it all", () => {
		const hit = hitOf(engagementSent(1000, { utmSource: 'spring', clickId: 'gclid' }))
		for (const field of [
			'ref',
			'source',
			'channel',
			'channelVersion',
			'clickId',
			'utmSource',
			'country',
			'region',
			'city',
			'language',
			'device',
			'browser',
			'os',
		]) {
			expect(hit).not.toHaveProperty(field)
		}
	})

	it('keeps at most 50 of the items one engagement saw, and none on any other hit', () => {
		const seen = Array.from({ length: 60 }, (_, i) => `offers:${i}`)
		expect(hitOf(engagementSent(1000, { impressions: seen })).impressions).toEqual(
			seen.slice(0, MAX_ITEMS_PER_BEACON)
		)
		expect(MAX_ITEMS_PER_BEACON).toBe(50)
		expect(hitOf(engagementSent(1000))).not.toHaveProperty('impressions')
		expect(hitOf(stored({ impressions: ['offers:1'] }))).not.toHaveProperty('impressions')
	})

	it('gives no lastAt to any other hit', () => {
		expect(hitOf(stored())).not.toHaveProperty('lastAt')
	})
})

describe('toHit goals and money', () => {
	it('counts the goals a hit completed and what they were worth, a refund its money alone', () => {
		const sale = hitOf(
			stored({
				type: 'goal',
				name: 'purchase',
				value: 49,
				currency: 'EUR',
				goals: [
					{ slug: 'purchase', value: 49 },
					{ slug: 'any-sale', value: 0 },
				],
				item: 'offers:12',
			})
		)
		expect(sale).toMatchObject({
			conversions: 2,
			revenue: 49,
			value: 49,
			currency: 'EUR',
			item: 'offers:12',
			goals: [
				{ slug: 'purchase', value: 49 },
				{ slug: 'any-sale', value: 0 },
			],
		})
		const refund = hitOf(
			stored({
				type: 'goal',
				name: 'purchase',
				value: -20,
				goals: [{ slug: 'purchase', value: -20 }],
				refund: true,
			})
		)
		expect(refund).toMatchObject({ conversions: 0, revenue: -20 })
		expect(refund).not.toHaveProperty('refund')
	})

	it('keeps the currency on a hit carrying money, and leaves a pageview without one', () => {
		expect(hitOf(stored({ currency: 'EUR' }))).not.toHaveProperty('currency')
		const converted = hitOf(
			stored({
				type: 'goal',
				name: 'purchase',
				value: 0,
				currency: 'EUR',
				originalValue: 30,
				originalCurrency: 'JPY',
			})
		)
		expect(converted).toMatchObject({
			value: 0,
			currency: 'EUR',
			originalValue: 30,
			originalCurrency: 'JPY',
		})
		const fixedGoal = hitOf(stored({ currency: 'EUR', goals: [{ slug: 'thanks', value: 5 }] }))
		expect(fixedGoal).toMatchObject({ currency: 'EUR', conversions: 1, revenue: 5 })
	})

	it('counts nothing on a hit that completed no goal', () => {
		const hit = hitOf(stored({ goals: [] }))
		expect(hit).not.toHaveProperty('conversions')
		expect(hit).not.toHaveProperty('revenue')
		expect(hit).not.toHaveProperty('goals')
	})
})

describe('toHit ids', () => {
	it("keys an order's hit by its dedupe key, so a retry meets the row it already wrote", () => {
		const order = stored({ type: 'goal', name: 'purchase', dedupeKey: `s.${'a'.repeat(64)}` })
		expect(hitOf(order).id).toBe(orderHitId(`s.${'a'.repeat(64)}`))
		expect(toHit(order, { receivedAt: new Date() }).id).toBe(hitOf(order).id)
	})

	it('gives every other hit a fresh id of its own time, in the order it was made', () => {
		const make = createUlidFactory()
		const first = toHit(stored(), { receivedAt: RECEIVED, ids: make })
		const second = toHit(stored(), { receivedAt: RECEIVED, ids: make })
		expect(first.id).not.toBe(second.id)
		expect([first.id, second.id].sort()).toEqual([first.id, second.id])
		expect(ulidTime(second.id)).toBe(RECEIVED.getTime())
	})
})

describe('toHit after normalizeEvent', () => {
	const normalize = (raw: RawEventInput, h: Record<string, string>, origin: 'wire' | 'server') =>
		normalizeEvent({
			raw,
			hostname: 'shop.example',
			headers: new Headers(h),
			geoResolver: noopResolver,
			salt: 'salt-1',
			now: RECEIVED,
			origin,
		})

	it('stores a server event with no visitor of its own under no visitor', async () => {
		const goal: RawEventInput = { type: 'goal', name: 'signup', path: '/welcome' }
		const anonymous = toHit(await normalize(goal, { 'user-agent': SERVER_USER_AGENT }, 'server'), {
			receivedAt: RECEIVED,
		})
		const visitor = toHit(
			await normalize(goal, { 'user-agent': 'UA', 'x-real-ip': '9.9.9.9' }, 'server'),
			{ receivedAt: RECEIVED }
		)
		expect(anonymous).toMatchObject({ v: '', server: true })
		expect(visitor.v).toMatch(/^[A-Za-z0-9_-]{16}$/)
	})

	it('files one order the same however often it is sent, and a refund apart from the sale', async () => {
		const sale: RawEventInput = {
			type: 'goal',
			name: 'purchase',
			path: '/orders',
			revenue: true,
			value: 49,
			orderId: 'ord_1',
		}
		const headers = { 'user-agent': SERVER_USER_AGENT }
		const first = toHit(await normalize(sale, headers, 'server'), { receivedAt: RECEIVED })
		const retry = toHit(await normalize(sale, headers, 'server'), { receivedAt: new Date() })
		const refund = toHit(await normalize({ ...sale, value: -49 }, headers, 'server'), {
			receivedAt: RECEIVED,
		})
		const browser = toHit(await normalize({ ...sale, revenue: undefined }, headers, 'wire'), {
			receivedAt: RECEIVED,
		})
		expect(first.id).toMatch(/^os\.[0-9a-f]{64}$/)
		expect(retry.id).toBe(first.id)
		expect(refund.id).not.toBe(first.id)
		expect(browser.id).toMatch(/^ow\./)
	})
})
