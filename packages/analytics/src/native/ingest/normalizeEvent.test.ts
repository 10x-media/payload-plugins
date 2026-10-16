import { describe, expect, it } from 'vitest'
import { MAX_ITEMS_PER_BEACON } from '../../goals/constants'
import type { BrowserAmounts } from '../../goals/match'
import type { Goal } from '../../goals/types'
import { MAX_GEO_LENGTH, MAX_QUERY_LENGTH, MAX_REFERRER_LENGTH } from '../../query/limits'
import { HOUR_MS } from '../../timeframe/tz'
import { toHit } from '../engine/toHit'
import { noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { SERVER_USER_AGENT } from './device'
import { itemRefKey, itemRefSignature } from './itemSignature'
import {
	eventTime,
	type ItemIngestOptions,
	normalizeEvent,
	type RawEventInput,
	sentAmount,
} from './normalizeEvent'
import { MAX_EVENT_VALUE, MAX_ORDER_ID_LENGTH } from './revenue'
import { CHANNEL_TAXONOMY_VERSION } from './source'

const headers = (h: Record<string, string>) => new Headers(h)

/** The row an event is stored as, where its source and channel are decided. */
const stored = (event: Awaited<ReturnType<typeof normalizeEvent>>) =>
	toHit(event, { receivedAt: event.timestamp })

describe('normalizeEvent', () => {
	it('builds a normalized event with geo, a visitor id, and no ip', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/pricing', hostname: 'site.com', durationMs: 1200 },
			hostname: 'site.com',
			headers: headers({
				'x-vercel-ip-country': 'US',
				'x-real-ip': '9.9.9.9',
				'user-agent': 'UA',
			}),
			geoResolver: platformHeaderResolver,
			trustedPlatform: 'vercel',
			salt: 'salt-1',
			now: new Date('2026-01-01T10:15:00Z'),
		})
		expect(ev.type).toBe('pageview')
		expect(ev.path).toBe('/pricing')
		expect(ev.country).toBe('US')
		expect(ev.durationMs).toBe(1200)
		expect(ev.visitorId).toMatch(/^[A-Za-z0-9_-]{16}$/)
		expect(JSON.stringify(ev)).not.toContain('9.9.9.9')
		expect(ev.timestamp.toISOString()).toBe('2026-01-01T10:15:00.000Z')
	})
	it('stores no country from a platform header while no platform is trusted', async () => {
		const trusted = await normalizeEvent({
			raw: { type: 'pageview', path: '/', hostname: 'site.com' },
			hostname: 'site.com',
			headers: headers({ 'cf-ipcountry': 'KP', 'x-forwarded-for': '9.9.9.9', 'user-agent': 'UA' }),
			geoResolver: platformHeaderResolver,
			trustedPlatform: 'cloudflare',
			salt: 's',
			now: new Date('2026-01-01T00:00:00Z'),
		})
		const spoofed = await normalizeEvent({
			raw: { type: 'pageview', path: '/', hostname: 'site.com' },
			hostname: 'site.com',
			headers: headers({ 'cf-ipcountry': 'KP', 'x-forwarded-for': '9.9.9.9', 'user-agent': 'UA' }),
			geoResolver: platformHeaderResolver,
			salt: 's',
			now: new Date('2026-01-01T00:00:00Z'),
		})
		expect(trusted.country).toBe('KP')
		expect(spoofed.country).toBeUndefined()
		expect(spoofed.visitorId).not.toBe(trusted.visitorId)
	})

	it('honors a noop geo resolver', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/', hostname: 'site.com' },
			hostname: 'site.com',
			headers: headers({ 'x-vercel-ip-country': 'US', 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-01-01T00:00:00Z'),
		})
		expect(ev.country).toBeUndefined()
	})

	it('derives device from the user-agent header, and the source and channel from the referrer', async () => {
		const event = await normalizeEvent({
			raw: {
				type: 'pageview',
				path: '/p',
				hostname: 'example.com',
				referrer: 'https://www.google.com/',
			},
			hostname: 'example.com',
			headers: new Headers({
				'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148',
			}),
			geoResolver: async () => ({}),
			salt: 'salt',
			now: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect(event.device).toBe('mobile')
		expect(stored(event)).toMatchObject({
			source: 'google.com',
			channel: 'organic-search',
			channelVersion: CHANNEL_TAXONOMY_VERSION,
		})
	})

	it('reports the utm_source lowercased as the origin, keeping the tag as written', async () => {
		const event = await normalizeEvent({
			raw: {
				type: 'pageview',
				path: '/p',
				hostname: 'example.com',
				query: 'utm_source=Google&utm_medium=cpc',
			},
			hostname: 'example.com',
			headers: new Headers({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0' }),
			geoResolver: async () => ({}),
			salt: 'salt',
			now: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect(event.utmSource).toBe('Google')
		expect(stored(event)).toMatchObject({ source: 'google', channel: 'paid-search' })
	})

	it('omits device entirely for a user agent that is not a device', async () => {
		const event = await normalizeEvent({
			raw: { type: 'pageview', path: '/p', hostname: 'example.com' },
			hostname: 'example.com',
			headers: new Headers({ 'user-agent': SERVER_USER_AGENT }),
			geoResolver: async () => ({}),
			salt: 'salt',
			now: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect('device' in event).toBe(false)
	})
})

describe('normalizeEvent modes', () => {
	const visit = {
		'x-vercel-ip-country': 'DE',
		'x-vercel-ip-country-region': 'BE',
		'x-vercel-ip-city': 'Berlin',
		'x-real-ip': '9.9.9.9',
		'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
		'accept-language': 'de-DE',
	}

	const measured = (raw: RawEventInput, mode?: 'c' | 'a' | 'f') =>
		normalizeEvent({
			raw,
			hostname: 'site.com',
			headers: headers(visit),
			geoResolver: platformHeaderResolver,
			trustedPlatform: 'vercel',
			salt: 'salt-1',
			now: new Date('2026-01-01T10:00:00Z'),
			...(mode ? { mode } : {}),
		})

	it('hashes the same visitor cookieless as in full, so a consent mid-visit counts one person', async () => {
		const page = { type: 'pageview', path: '/', hostname: 'site.com' } as const
		const full = await measured(page)
		const cookieless = await measured(page, 'c')
		expect(full.mode).toBe('f')
		expect(cookieless.mode).toBe('c')
		expect(cookieless.visitorId).toBe(full.visitorId)
		expect(cookieless.visitorId).not.toBe('')
		expect(cookieless.region).toBe('BE')
	})

	it('keeps no visitor, region, city, time or scroll for an anonymous pageview, whatever it carries', async () => {
		const event = await measured(
			{
				type: 'pageview',
				path: '/pricing',
				hostname: 'site.com',
				referrer: 'https://news.example/story',
				query: 'utm_source=newsletter&utm_campaign=spring&gclid=abc',
				durationMs: 4000,
				scrollDepth: 0,
			},
			'a'
		)
		expect(event).toMatchObject({
			mode: 'a',
			visitorId: '',
			country: 'DE',
			referrerHost: 'news.example',
			utmSource: 'newsletter',
			utmCampaign: 'spring',
			clickId: 'gclid',
			device: 'desktop',
			language: 'de-de',
		})
		for (const field of ['region', 'city', 'durationMs', 'scrollDepth']) {
			expect(event).not.toHaveProperty(field)
		}
		expect(JSON.stringify(event)).not.toContain('9.9.9.9')
	})

	it('keeps nothing of an anonymous engagement', async () => {
		const event = await measured(
			{
				type: 'engagement',
				path: '/pricing',
				hostname: 'site.com',
				durationMs: 4000,
				scrollDepth: 40,
				impressions: ['offers:1'],
			},
			'a'
		)
		expect(event).not.toHaveProperty('durationMs')
		expect(event).not.toHaveProperty('scrollDepth')
		expect(event).not.toHaveProperty('impressions')
	})

	it('files an anonymous landing under its source, and an anonymous page further in under none', async () => {
		const landing = stored(
			await measured({ type: 'pageview', path: '/', hostname: 'site.com' }, 'a')
		)
		const further = stored(
			await measured(
				{ type: 'pageview', path: '/next', hostname: 'site.com', referrer: 'https://site.com/' },
				'a'
			)
		)
		expect(landing).toMatchObject({ v: '', mode: 'a', landing: true, source: 'direct' })
		expect(further).toMatchObject({ v: '', mode: 'a', landing: false })
		expect(further).not.toHaveProperty('source')
		expect(further).not.toHaveProperty('channel')
	})
})

describe('normalizeEvent contract growth', () => {
	const build = async (raw: Record<string, unknown>, goals?: Goal[]) =>
		normalizeEvent({
			raw: raw as never,
			hostname: String(raw.hostname ?? 'site.com'),
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			...(goals ? { goals } : {}),
		})

	it('stores a goal event with its value and currency', async () => {
		const ev = await build({
			type: 'goal',
			name: 'purchase',
			path: '/checkout/done',
			hostname: 'h',
			value: 19.5,
			currency: 'EUR',
		})
		expect(ev.type).toBe('goal')
		expect(ev.name).toBe('purchase')
		expect(ev.value).toBe(19.5)
		expect(ev.currency).toBe('EUR')
	})

	it('drops a negative or non-finite value and a malformed currency', async () => {
		const ev = await build({
			type: 'goal',
			name: 'purchase',
			path: '/x',
			hostname: 'h',
			value: -5,
			currency: 'eur',
		})
		expect(ev.value).toBeUndefined()
		expect(ev.currency).toBeUndefined()
		const nan = await build({ type: 'goal', name: 'p', path: '/x', hostname: 'h', value: 'lots' })
		expect(nan.value).toBeUndefined()
	})

	it('drops an amount past the ceiling, on either origin', async () => {
		const sale = { type: 'goal', name: 'purchase', path: '/x', hostname: 'h' }
		const wire = await build({ ...sale, value: MAX_EVENT_VALUE * 2 })
		const server = await normalizeEvent({
			raw: { ...sale, value: -MAX_EVENT_VALUE * 2, revenue: true } as never,
			hostname: 'h',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			origin: 'server',
		})

		expect(wire.value).toBeUndefined()
		expect(server.value).toBeUndefined()
		expect((await build({ ...sale, value: MAX_EVENT_VALUE })).value).toBe(MAX_EVENT_VALUE)
	})

	// The endpoint refuses such a body outright; this is the second gate behind it, so a flag
	// that ever reaches the normalizer on the wire path still buys nothing.
	it('ignores a revenue flag on the wire origin', async () => {
		const purchase: Goal = { slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }
		const forged = {
			type: 'goal',
			name: 'purchase',
			path: '/x',
			hostname: 'h',
			value: -49,
			revenue: true,
		}

		expect((await build(forged, [purchase])).goals).toEqual([{ slug: 'purchase', value: 0 }])
	})

	it('keeps a refund on the server origin, and namespaces the two origins apart', async () => {
		const purchase: Goal = { slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }
		const args = {
			hostname: 'h',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			goals: [purchase],
		}
		const refund = await normalizeEvent({
			...args,
			raw: {
				type: 'goal',
				name: 'purchase',
				path: '/x',
				hostname: 'h',
				value: -49,
				revenue: true,
				orderId: 'ord_1',
			},
			origin: 'server',
		})
		const browser = await normalizeEvent({
			...args,
			raw: { type: 'goal', name: 'purchase', path: '/x', hostname: 'h', orderId: 'ord_1' },
			origin: 'wire',
		})

		expect(refund.goals).toEqual([{ slug: 'purchase', value: -49 }])
		expect(refund.dedupeKey?.startsWith('s.')).toBe(true)
		expect(browser.dedupeKey?.startsWith('w.')).toBe(true)
		expect(refund.dedupeKey).not.toBe(browser.dedupeKey)
	})

	it('drops an order id past the cap rather than truncating two orders into one', async () => {
		const sale = { type: 'goal', name: 'purchase', path: '/x', hostname: 'h' }
		const long = await build({ ...sale, orderId: 'x'.repeat(MAX_ORDER_ID_LENGTH + 1) })

		expect(long.dedupeKey).toBeUndefined()
		expect((await build({ ...sale, orderId: 'ord_1' })).dedupeKey).toBeDefined()
		// Both ingest paths refuse such an id before it gets here; a Stripe session id keys.
		const stripe = 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u'
		expect((await build({ ...sale, orderId: stripe })).dedupeKey).toMatch(/^w\.[0-9a-f]{64}$/)
	})

	// Trackers before this one copied the order id into props, which stored it in clear.
	it('keeps no orderId prop on an event carrying an order, and keeps every other prop', async () => {
		const sale = { type: 'goal', name: 'purchase', path: '/x', hostname: 'h' }
		const ordered = await build({
			...sale,
			orderId: 'ord_1',
			props: { orderId: 'ord_1', plan: 'pro' },
		})
		const plain = await build({ ...sale, props: { orderId: 'quote-7', plan: 'pro' } })

		expect(ordered.props).toEqual({ plan: 'pro' })
		expect(JSON.stringify(stored(ordered))).not.toContain('ord_1')
		expect(plain.props).toEqual({ orderId: 'quote-7', plan: 'pro' })
	})

	it('marks a server refund, keying it by its own refund id', async () => {
		const purchase: Goal = { slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }
		const server = (raw: Record<string, unknown>) =>
			normalizeEvent({
				raw: { type: 'goal', name: 'purchase', path: '/x', hostname: 'h', ...raw } as never,
				hostname: 'h',
				headers: headers({ 'user-agent': 'UA' }),
				geoResolver: noopResolver,
				salt: 's',
				now: new Date('2026-06-01T00:00:00Z'),
				goals: [purchase],
				origin: 'server',
			})
		const sale = await server({ value: 49, revenue: true, orderId: 'ord_1', refundId: 're_1' })
		const first = await server({ value: -20, revenue: true, orderId: 'ord_1', refundId: 're_1' })
		const second = await server({ value: -9, revenue: true, orderId: 'ord_1', refundId: 're_2' })
		const retry = await server({ value: -20, revenue: true, orderId: 'ord_1', refundId: 're_1' })

		expect(sale.refund).toBeUndefined()
		expect(first.refund).toBe(true)
		expect(stored(first)).toMatchObject({ conversions: 0, revenue: -20 })
		expect(stored(sale)).toMatchObject({ conversions: 1, revenue: 49 })
		expect(new Set([sale.dedupeKey, first.dedupeKey, second.dedupeKey]).size).toBe(3)
		expect(retry.dedupeKey).toBe(first.dedupeKey)
	})

	it('rounds and clamps scrollDepth into 0-100', async () => {
		const depth = async (scrollDepth: unknown) =>
			(await build({ type: 'pageview', path: '/x', hostname: 'h', scrollDepth })).scrollDepth
		expect(await depth(62.4)).toBe(62)
		expect(await depth(140)).toBe(100)
		expect(await depth(-1)).toBeUndefined()
		expect(await depth(0)).toBe(0)
	})

	it('drops a durationMs that is not a finite, non-negative number', async () => {
		const duration = async (durationMs: unknown) =>
			(await build({ type: 'pageview', path: '/x', hostname: 'h', durationMs })).durationMs
		expect(await duration(Number.POSITIVE_INFINITY)).toBeUndefined()
		expect(await duration(JSON.parse('{"d":1e400}').d)).toBeUndefined()
		expect(await duration(Number.NaN)).toBeUndefined()
		expect(await duration(-1)).toBeUndefined()
		expect(await duration('900')).toBeUndefined()
		expect(await duration(900)).toBe(900)
	})

	it('drops a durationMs past the half hour one message may carry', async () => {
		for (const type of ['pageview', 'engagement']) {
			const duration = async (durationMs: unknown) =>
				(await build({ type, path: '/x', hostname: 'h', durationMs })).durationMs
			expect(await duration(1_800_000)).toBe(1_800_000)
			expect(await duration(1_800_001)).toBeUndefined()
			expect(await duration(86_400_000)).toBeUndefined()
		}
	})

	it('bounds an engagement time and scroll like a pageview, dropping what is malformed', async () => {
		const engagement = (over: Record<string, unknown>) =>
			build({ type: 'engagement', path: '/x', hostname: 'h', ...over })
		expect(await engagement({ durationMs: 4000, scrollDepth: 30.6 })).toMatchObject({
			durationMs: 4000,
			scrollDepth: 31,
		})
		expect(await engagement({ scrollDepth: 140 })).toMatchObject({ scrollDepth: 100 })
		const malformed = await engagement({ durationMs: -1, scrollDepth: Number.NaN })
		expect(malformed).not.toHaveProperty('durationMs')
		expect(malformed).not.toHaveProperty('scrollDepth')
	})

	it('keeps nothing on an engagement that a hit would carry besides its time and scroll', async () => {
		const ev = await build(
			{
				type: 'engagement',
				name: 'signup',
				path: '/thank-you',
				hostname: 'h',
				durationMs: 4000,
				props: { plan: 'pro' },
				value: 49,
				currency: 'EUR',
				orderId: 'ord_1',
				items: [{ id: 'sku-1' }],
			},
			[{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } }]
		)
		expect(ev).toMatchObject({ type: 'engagement', path: '/thank-you', durationMs: 4000 })
		for (const field of ['name', 'props', 'value', 'currency', 'dedupeKey', 'goals'] as const) {
			expect(ev[field]).toBeUndefined()
		}
	})

	it('drops time and scroll from an event and a goal, which never feed the averages', async () => {
		for (const type of ['event', 'goal']) {
			const ev = await build({
				type,
				name: 'signup',
				path: '/x',
				hostname: 'h',
				durationMs: 4000,
				scrollDepth: 50,
			})
			expect(ev).not.toHaveProperty('durationMs')
			expect(ev).not.toHaveProperty('scrollDepth')
		}
	})

	it('caps path and hostname, which daily totals are keyed by', async () => {
		const ev = await build({
			type: 'pageview',
			path: `/${'p'.repeat(900)}`,
			hostname: `${'h'.repeat(300)}.test`,
		})
		expect(ev.path).toHaveLength(512)
		expect(ev.hostname).toHaveLength(253)
	})

	it('truncates the event name, which the event breakdown groups by', async () => {
		const ev = await build({
			type: 'event',
			name: 'n'.repeat(500),
			path: '/x',
			hostname: 'h',
		})
		expect(ev.name).toHaveLength(128)
	})

	it('drops a non-string name', async () => {
		const ev = await build({ type: 'pageview', path: '/x', hostname: 'h', name: 12 })
		expect(ev.name).toBeUndefined()
	})

	it('keeps flat scalar props and drops the rest', async () => {
		const ev = await build({
			type: 'event',
			name: 'cta',
			path: '/x',
			hostname: 'h',
			props: { plan: 'pro', seats: 3, trial: true, nested: { a: 1 }, list: [1], nothing: null },
		})
		expect(ev.props).toEqual({ plan: 'pro', seats: 3, trial: true })
	})

	it('truncates long string prop values and drops overlong keys', async () => {
		const ev = await build({
			type: 'event',
			name: 'cta',
			path: '/x',
			hostname: 'h',
			props: { long: 'a'.repeat(400), ['k'.repeat(65)]: 'v' },
		})
		expect(ev.props?.long).toHaveLength(256)
		expect(Object.keys(ev.props ?? {})).toEqual(['long'])
	})

	it('keeps at most 20 props and ignores a non-object props', async () => {
		const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]))
		const ev = await build({ type: 'event', name: 'cta', path: '/x', hostname: 'h', props: many })
		expect(Object.keys(ev.props ?? {})).toHaveLength(20)
		const notAnObject = await build({
			type: 'event',
			name: 'c',
			path: '/x',
			hostname: 'h',
			props: [1, 2],
		})
		expect(notAnObject.props).toBeUndefined()
	})

	it('stores the goals the event completes, with their resolved value', async () => {
		const goals: Goal[] = [
			{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
			{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
		]
		const ev = await build(
			{ type: 'goal', name: 'purchase', path: '/x', hostname: 'h', value: 12 },
			goals
		)
		expect(ev.goals).toEqual([{ slug: 'purchase', value: 12 }])
		const pv = await build({ type: 'pageview', path: '/thank-you', hostname: 'h' }, goals)
		expect(pv.goals).toEqual([{ slug: 'thanks', value: 0 }])
	})

	it('matches goals against the sanitized value, not the raw one', async () => {
		const goals: Goal[] = [
			{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' }, value: { fixed: 5 } },
		]
		const ev = await build(
			{ type: 'goal', name: 'purchase', path: '/x', hostname: 'h', value: -3 },
			goals
		)
		expect(ev.goals).toEqual([{ slug: 'purchase', value: 5 }])
	})

	it('omits goals entirely when nothing matches', async () => {
		const ev = await build({ type: 'pageview', path: '/x', hostname: 'h' }, [
			{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
		])
		expect(ev.goals).toBeUndefined()
	})
})

describe('normalizeEvent revenue.browserAmounts', () => {
	const goals: Goal[] = [
		{
			slug: 'demo',
			name: 'Demo',
			match: { kind: 'goal' },
			value: { fixed: 500 },
			currency: 'EUR',
		},
		{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
		{
			slug: 'lead',
			name: 'Lead',
			match: { kind: 'event', name: 'lead' },
			value: { prop: 'amount' },
		},
	]
	const build = (
		raw: Record<string, unknown>,
		browserAmounts: BrowserAmounts | undefined,
		origin: 'wire' | 'server' = 'wire'
	) =>
		normalizeEvent({
			raw: { path: '/x', hostname: 'h', ...raw } as never,
			hostname: 'h',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			goals,
			origin,
			...(browserAmounts ? { browserAmounts } : {}),
		})
	const money = (ev: Awaited<ReturnType<typeof normalizeEvent>>) => ({
		value: ev.value,
		currency: ev.currency,
		goals: ev.goals,
	})
	const forged = { type: 'goal', name: 'demo', value: 1_000_000, currency: 'JPY' }
	const sale = { type: 'goal', name: 'purchase', value: 49, currency: 'USD', orderId: 'ord_1' }
	const lead = { type: 'event', name: 'lead', value: 7, props: { amount: 80 } }

	it("lets a goal's fixed value and currency win over the browser's by default, and keeps a sale's", async () => {
		expect(money(await build(forged, undefined))).toEqual({
			value: 500,
			currency: 'EUR',
			goals: [{ slug: 'demo', value: 500 }],
		})
		expect(money(await build(sale, undefined))).toEqual({
			value: 49,
			currency: 'USD',
			goals: [{ slug: 'purchase', value: 49 }],
		})
		expect((await build(lead, 'fixed')).goals).toEqual([{ slug: 'lead', value: 7 }])
	})

	it("takes no amount from the browser under 'none', a fixed value still counting", async () => {
		expect(money(await build(forged, 'none'))).toEqual({
			value: 500,
			currency: 'EUR',
			goals: [{ slug: 'demo', value: 500 }],
		})
		expect(money(await build(sale, 'none'))).toEqual({
			value: undefined,
			currency: undefined,
			goals: [{ slug: 'purchase', value: 0 }],
		})
		expect((await build(lead, 'none')).goals).toEqual([{ slug: 'lead', value: 0 }])
		expect(stored(await build(sale, 'none'))).toMatchObject({ conversions: 1, revenue: 0 })
	})

	it("takes the browser's amount over a fixed value under 'trust', as before the option", async () => {
		expect(money(await build(forged, 'trust'))).toEqual({
			value: 1_000_000,
			currency: 'JPY',
			goals: [{ slug: 'demo', value: 1_000_000 }],
		})
		expect((await build({ ...lead, value: undefined }, 'trust')).goals).toEqual([
			{ slug: 'lead', value: 80 },
		])
	})

	it('always believes server code', async () => {
		expect(money(await build(forged, 'none', 'server'))).toEqual({
			value: 1_000_000,
			currency: 'JPY',
			goals: [{ slug: 'demo', value: 1_000_000 }],
		})
	})

	it('converts a fixed value from its goal currency like any amount', async () => {
		const ev = await normalizeEvent({
			raw: { ...forged, path: '/x', hostname: 'h' } as never,
			hostname: 'h',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			goals,
			reportingCurrency: 'USD',
			convertCurrency: ({ amount }) => amount * 2,
		})
		expect(money(ev)).toEqual({
			value: 1000,
			currency: 'USD',
			goals: [{ slug: 'demo', value: 1000, sent: 500 }],
		})
		expect(ev).toMatchObject({ originalValue: 500, originalCurrency: 'EUR' })
	})

	it("ignores a browser's completion of a server-only goal, and counts the server's", async () => {
		const serverOnly: Goal[] = [
			{ slug: 'subscription', name: 'Subscription', match: { kind: 'goal' }, browser: false },
			{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } },
		]
		const send = (name: string, origin: 'wire' | 'server') =>
			normalizeEvent({
				raw: { type: 'goal', name, path: '/x', hostname: 'h', value: 1e12 },
				hostname: 'h',
				headers: headers({ 'user-agent': 'UA' }),
				geoResolver: noopResolver,
				salt: 's',
				now: new Date('2026-06-01T00:00:00Z'),
				goals: serverOnly,
				origin,
			})
		expect((await send('subscription', 'wire')).goals).toBeUndefined()
		expect((await send('signup', 'wire')).goals).toEqual([{ slug: 'signup', value: 1e12 }])
		expect((await send('subscription', 'server')).goals).toEqual([
			{ slug: 'subscription', value: 1e12 },
		])
	})
})

describe('normalizeEvent completions worth their own amounts', () => {
	const goals: Goal[] = [
		{
			slug: 'pricing-any',
			name: 'a',
			match: { kind: 'path', pattern: '/pricing/*' },
			value: { fixed: 5 },
		},
		{
			slug: 'pricing-ent',
			name: 'b',
			match: { kind: 'path', pattern: '/pricing/enterprise' },
			value: { fixed: 50 },
		},
		{
			slug: 'signup-lead',
			name: 'c',
			match: { kind: 'event', name: 'signup' },
			value: { fixed: 10 },
			currency: 'EUR',
		},
		{
			slug: 'signup-value',
			name: 'd',
			match: { kind: 'event', name: 'signup' },
			value: { prop: 'amount' },
		},
	]
	const build = (
		raw: Record<string, unknown>,
		browserAmounts: BrowserAmounts | undefined,
		reportingCurrency?: string
	) =>
		normalizeEvent({
			raw: { hostname: 'h', ...raw } as never,
			hostname: 'h',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			goals,
			...(reportingCurrency
				? { reportingCurrency, convertCurrency: ({ amount }: { amount: number }) => amount * 2 }
				: {}),
			...(browserAmounts ? { browserAmounts } : {}),
		})
	const pageview = { type: 'pageview', path: '/pricing/enterprise' }
	const signup = { type: 'event', name: 'signup', path: '/s', props: { amount: 80 } }

	it('counts each fixed goal an event completes at its own value, in every mode', async () => {
		for (const mode of [undefined, 'none', 'fixed', 'trust'] as const) {
			const ev = await build(pageview, mode)
			expect(ev.goals).toEqual([
				{ slug: 'pricing-any', value: 5 },
				{ slug: 'pricing-ent', value: 50 },
			])
			expect(stored(ev)).toMatchObject({ conversions: 2, revenue: 55 })
		}
	})

	it('reads a value property for its own goal beside a fixed one, unless the mode takes none', async () => {
		for (const mode of [undefined, 'fixed', 'trust'] as const) {
			expect((await build(signup, mode)).goals).toEqual([
				{ slug: 'signup-lead', value: 10 },
				{ slug: 'signup-value', value: 80 },
			])
		}
		expect((await build(signup, 'none')).goals).toEqual([
			{ slug: 'signup-lead', value: 10 },
			{ slug: 'signup-value', value: 0 },
		])
	})

	it('converts each completion from its own currency, the row carrying the first amount', async () => {
		const ev = await build(signup, 'fixed', 'USD')
		expect(ev.goals).toEqual([
			{ slug: 'signup-lead', value: 20, sent: 10 },
			{ slug: 'signup-value', value: 80 },
		])
		expect(ev).toMatchObject({
			value: 20,
			currency: 'USD',
			originalValue: 10,
			originalCurrency: 'EUR',
		})
	})

	it('gives a believed browser amount to a goal without a fixed value, never to one with one', async () => {
		const sent = { ...signup, value: 30, currency: 'USD' }
		expect((await build(sent, 'fixed')).goals).toEqual([
			{ slug: 'signup-lead', value: 10 },
			{ slug: 'signup-value', value: 30 },
		])
		expect((await build(sent, 'trust')).goals).toEqual([
			{ slug: 'signup-lead', value: 30 },
			{ slug: 'signup-value', value: 30 },
		])
	})
})

describe('sentAmount', () => {
	const sent = { value: 9, currency: 'USD' }

	it('answers the amount as sent, believed under trust and fixed, and nothing under none', () => {
		expect(sentAmount({ ...sent, believed: 'trust' })).toEqual(sent)
		expect(sentAmount({ ...sent, believed: 'fixed' })).toEqual(sent)
		expect(sentAmount({ ...sent, believed: 'none' })).toEqual({})
		expect(sentAmount({ value: undefined, currency: undefined, believed: 'fixed' })).toEqual({})
	})
})

describe('normalizeEvent native dimensions', () => {
	const CHROME_UA =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

	const build = async (raw: Record<string, unknown>, h: Record<string, string>) =>
		normalizeEvent({
			raw: raw as never,
			hostname: String(raw.hostname ?? 'site.com'),
			headers: headers(h),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
		})

	it('stores browser, os, language and the utm keys', async () => {
		const ev = await build(
			{
				type: 'pageview',
				path: '/pricing',
				hostname: 'site.com',
				query:
					'utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_content=hero&utm_term=shoes&page=2',
			},
			{ 'user-agent': CHROME_UA, 'accept-language': 'de-DE,de;q=0.9' }
		)
		expect(ev).toMatchObject({
			browser: 'chrome',
			os: 'macos',
			language: 'de-de',
			utmSource: 'newsletter',
			utmMedium: 'email',
			utmCampaign: 'spring',
			utmContent: 'hero',
			utmTerm: 'shoes',
		})
	})

	it('never stores the raw query itself', async () => {
		const ev = await build(
			{ type: 'pageview', path: '/p', hostname: 'site.com', query: 'token=secret&utm_source=g' },
			{ 'user-agent': CHROME_UA }
		)
		expect('query' in ev).toBe(false)
		expect(JSON.stringify(ev)).not.toContain('secret')
		expect(ev.utmSource).toBe('g')
	})

	it('reads only the first MAX_QUERY_LENGTH characters of the query', async () => {
		const padding = `pad=${'x'.repeat(MAX_QUERY_LENGTH)}`
		const ev = await build(
			{ type: 'pageview', path: '/p', hostname: 'site.com', query: `${padding}&utm_source=late` },
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.utmSource).toBeUndefined()
	})

	it('drops a query that is not a string', async () => {
		const ev = await build(
			{ type: 'event', name: 'signup', path: '/p', hostname: 'site.com', query: { a: 1 } },
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.utmSource).toBeUndefined()
		expect(ev.browser).toBe('chrome')
	})

	it('classifies events and goals too, not just pageviews', async () => {
		const ev = await build(
			{
				type: 'goal',
				name: 'purchase',
				path: '/thanks',
				hostname: 'site.com',
				query: 'utm_source=google',
			},
			{ 'user-agent': CHROME_UA, 'accept-language': 'en-US,en;q=0.9' }
		)
		expect(ev).toMatchObject({
			browser: 'chrome',
			os: 'macos',
			language: 'en-us',
			utmSource: 'google',
		})
	})

	it('reads an engagement like the pageview it repeats, and stores none of it on its row', async () => {
		const sent = {
			path: '/pricing',
			hostname: 'site.com',
			referrer: 'https://www.google.com/search?q=shoes',
			query: 'utm_source=newsletter&utm_medium=email&utm_campaign=spring',
		}
		const agent = { 'user-agent': CHROME_UA, 'accept-language': 'de-DE,de;q=0.9' }
		const pageview = await build({ type: 'pageview', ...sent }, agent)
		const engagement = await build({ type: 'engagement', ...sent, durationMs: 4000 }, agent)
		const attribution = ({
			timestamp: _t,
			type: _type,
			durationMs: _d,
			...rest
		}: typeof pageview) => rest
		expect(attribution(engagement)).toEqual(attribution(pageview))
		expect(engagement).toMatchObject({ utmCampaign: 'spring', browser: 'chrome' })
		expect(stored(pageview)).toMatchObject({ channel: 'email', browser: 'chrome' })
		for (const attribute of ['utmCampaign', 'channel', 'source', 'browser', 'language']) {
			expect(stored(engagement), attribute).not.toHaveProperty(attribute)
		}
	})

	it('omits browser and os for the synthetic server agent, keeping the fields absent', async () => {
		const ev = await build(
			{ type: 'event', name: 'invoice_paid', path: '/hook', hostname: 'site.com' },
			{ 'user-agent': SERVER_USER_AGENT }
		)
		expect('browser' in ev).toBe(false)
		expect('os' in ev).toBe(false)
		expect('language' in ev).toBe(false)
		expect('utmSource' in ev).toBe(false)
	})

	it('stores the referrer host beside the referrer, and neither when there is none', async () => {
		const ev = await build(
			{
				type: 'pageview',
				path: '/p',
				hostname: 'site.com',
				referrer: 'https://www.example.org/path?x=1',
			},
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.referrer).toBe('https://www.example.org/path')
		expect(ev.referrerHost).toBe('example.org')

		const direct = await build(
			{ type: 'pageview', path: '/p', hostname: 'site.com' },
			{ 'user-agent': CHROME_UA }
		)
		expect('referrerHost' in direct).toBe(false)
	})

	it('never stores a referrer query string, a same-origin one least of all', async () => {
		const ev = await build(
			{
				type: 'pageview',
				path: '/p',
				hostname: 'site.com',
				referrer: 'https://site.com/reset?token=abc#top',
			},
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.referrer).toBe('https://site.com/reset')
		expect(JSON.stringify(ev)).not.toContain('abc')
		expect(stored(ev).source).toBe('direct')
	})

	it('truncates an over-long referrer without disturbing its host or channel', async () => {
		const ev = await build(
			{
				type: 'pageview',
				path: '/p',
				hostname: 'site.com',
				referrer: `https://news.example.org/${'a'.repeat(MAX_REFERRER_LENGTH)}`,
			},
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.referrer).toHaveLength(MAX_REFERRER_LENGTH)
		expect(ev.referrerHost).toBe('news.example.org')
		expect(stored(ev).source).toBe('news.example.org')
		expect(stored(ev).channel).toBe('referral')
	})

	it('reports no referrer host for internal navigation, as source reports direct', async () => {
		for (const referrer of ['https://site.com/other', 'https://www.site.com/other']) {
			const ev = await build(
				{ type: 'pageview', path: '/p', hostname: 'site.com', referrer },
				{ 'user-agent': CHROME_UA }
			)
			expect('referrerHost' in ev).toBe(false)
			expect(stored(ev).source).toBe('direct')
		}
	})

	it('reads a referrer on another hostname of the scope as internal: no landing, no referral', async () => {
		const ev = await normalizeEvent({
			raw: {
				type: 'pageview',
				path: '/p',
				hostname: 'site.com',
				referrer: 'https://shop.com/cart',
			},
			hostname: 'site.com',
			headers: headers({ 'user-agent': CHROME_UA }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
			siblings: new Set(['shop.com']),
		})
		expect('referrerHost' in ev).toBe(false)
		expect(ev.siteReferrer).toBe(true)
		expect(stored(ev)).toMatchObject({ landing: false, source: 'direct', channel: 'direct' })
		expect(stored(ev)).not.toHaveProperty('ref')
	})

	it('drops a referrer that is not a string instead of throwing', async () => {
		for (const referrer of [{}, 42, ['https://example.org/'], true]) {
			const ev = await build(
				{ type: 'pageview', path: '/p', hostname: 'site.com', referrer },
				{ 'user-agent': CHROME_UA }
			)
			expect(ev.referrer).toBeUndefined()
			expect('referrerHost' in ev).toBe(false)
			expect(stored(ev).source).toBe('direct')
		}
	})

	it('caps the geo values, which breakdowns group by', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/p', hostname: 'site.com' },
			hostname: 'site.com',
			headers: headers({ 'user-agent': CHROME_UA }),
			geoResolver: () => ({
				country: 'U'.repeat(MAX_GEO_LENGTH + 50),
				region: 'R'.repeat(MAX_GEO_LENGTH + 50),
				city: 'C'.repeat(MAX_GEO_LENGTH + 50),
			}),
			salt: 's',
			now: new Date('2026-06-01T00:00:00Z'),
		})
		expect(ev.country).toHaveLength(MAX_GEO_LENGTH)
		expect(ev.region).toHaveLength(MAX_GEO_LENGTH)
		expect(ev.city).toHaveLength(MAX_GEO_LENGTH)
	})

	it('leaves an absent geo value absent rather than empty', async () => {
		const ev = await build(
			{ type: 'pageview', path: '/p', hostname: 'site.com' },
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.country).toBeUndefined()
		expect(ev.region).toBeUndefined()
		expect(ev.city).toBeUndefined()
	})
})

describe('eventTime', () => {
	const received = new Date('2026-10-02T00:03:00.000Z')

	it("files an engagement at its pageview's start, so time sent after midnight stays on its day", () => {
		const sinceMs = 5 * 60_000
		expect(eventTime({ type: 'engagement', sinceMs }, received)).toEqual(
			new Date('2026-10-01T23:58:00.000Z')
		)
		expect(eventTime({ type: 'engagement', sinceMs: 24 * HOUR_MS }, received)).toEqual(
			new Date(received.getTime() - 24 * HOUR_MS)
		)
		expect(eventTime({ type: 'engagement', sinceMs: 0 }, received)).toEqual(received)
	})

	it('reads whole milliseconds, so a fraction cannot move the start off the clock', () => {
		expect(eventTime({ type: 'engagement', sinceMs: 1500.6 }, received)).toEqual(
			new Date(received.getTime() - 1501)
		)
	})

	it('files it on arrival when the start would be in the future, over a day back, or is no time', () => {
		for (const sinceMs of [
			-1,
			24 * HOUR_MS + 1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			'60000',
			null,
			undefined,
		]) {
			expect(eventTime({ type: 'engagement', sinceMs } as never, received)).toBe(received)
		}
	})

	it('files every other type on arrival, whatever start it claims', () => {
		for (const type of ['pageview', 'event', 'goal'] as const) {
			expect(eventTime({ type, sinceMs: HOUR_MS }, received)).toBe(received)
		}
	})

	it('files an event that waited in the page when it was sent, of every type', () => {
		for (const type of ['pageview', 'event', 'goal', 'engagement'] as const) {
			expect(eventTime({ type, ageMs: 10 * 60_000 }, received)).toEqual(
				new Date('2026-10-01T23:53:00.000Z')
			)
		}
	})

	// A pageview held by a pending gate, and its engagement held behind it, land at the same start.
	it('files a held engagement at its held pageview start', () => {
		const pageview = eventTime({ type: 'pageview', ageMs: 10 * 60_000 }, received)
		const engagement = eventTime(
			{ type: 'engagement', ageMs: 6 * 60_000, sinceMs: 4 * 60_000 },
			received
		)
		expect(engagement).toEqual(pageview)
	})

	it('reaches back a day at most, and ignores a wait it cannot have had', () => {
		expect(
			eventTime({ type: 'engagement', ageMs: 20 * HOUR_MS, sinceMs: 20 * HOUR_MS }, received)
		).toEqual(new Date(received.getTime() - 24 * HOUR_MS))
		for (const ageMs of [-1, 24 * HOUR_MS + 1, Number.NaN, '60000', null]) {
			expect(eventTime({ type: 'pageview', ageMs } as never, received)).toBe(received)
		}
	})
})

describe('normalizeEvent revenue items', () => {
	const sale = (raw: { items?: unknown; props?: Record<string, unknown> }) =>
		normalizeEvent({
			raw: { type: 'goal', name: 'purchase', path: '/checkout', value: 49, ...raw },
			hostname: 'site.com',
			headers: headers({}),
			geoResolver: noopResolver,
			salt: 'salt-1',
			now: new Date('2026-01-01T10:15:00Z'),
		})

	// Props are the bounded column the lines already fit in, and nothing groups or filters on them.
	it('stores the lines under props, beside the props that were sent', async () => {
		const ev = await sale({
			props: { plan: 'pro' },
			items: [{ id: 'sku-1', name: 'Mug', quantity: 2, price: 12 }],
		})
		expect(ev.props).toEqual({
			plan: 'pro',
			items: [{ id: 'sku-1', name: 'Mug', quantity: 2, price: 12 }],
		})
	})

	it('drops a line with no id, and everything past the cap', async () => {
		const ev = await sale({
			items: [
				{ name: 'no id' },
				...Array.from({ length: 30 }, (_, index) => ({ id: `sku-${index}` })),
			],
		})
		expect((ev.props?.items as unknown[]).length).toBe(20)
	})

	it('leaves props alone when the sale carried no lines', async () => {
		expect((await sale({ items: 'not an array' })).props).toBeUndefined()
	})
})

describe('normalizeEvent content items', () => {
	const key = itemRefKey('test-secret')
	const signed = (ref: string): string => `${ref}@${itemRefSignature(key, ref)}`
	const flipLast = (value: string): string =>
		`${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`
	const items: ItemIngestOptions = {
		collections: new Set(['offers']),
		signature: { mode: 'required', key },
	}
	const normalize = (raw: RawEventInput, options: ItemIngestOptions | null = items) =>
		normalizeEvent({
			raw,
			hostname: 'site.com',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 'salt-1',
			now: new Date('2026-01-01T10:15:00Z'),
			...(options ? { items: options } : {}),
		})
	const fromServer = (raw: RawEventInput, options: ItemIngestOptions = items) =>
		normalizeEvent({
			raw,
			hostname: 'site.com',
			headers: headers({ 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 'salt-1',
			now: new Date('2026-01-01T10:15:00Z'),
			origin: 'server',
			items: options,
		})

	it('keeps the item of an event and a goal whose collection is bound, under its bare ref', async () => {
		const click = await normalize({
			type: 'event',
			name: 'item_click',
			path: '/p',
			item: signed('offers:1'),
		})
		const goal = await normalize({
			type: 'goal',
			name: 'book-demo',
			path: '/p',
			item: signed('offers:1'),
		})
		expect(click.item).toBe('offers:1')
		expect(goal.item).toBe('offers:1')
	})

	it('drops an unsigned ref from a page while signatures are required, keeping the event', async () => {
		const event = await normalize({ type: 'event', name: 'x', path: '/p', item: 'offers:1' })
		expect(event.type).toBe('event')
		expect(event.item).toBeUndefined()
	})

	it('drops a tampered ref, keeping the event', async () => {
		const otherKey = itemRefKey('another-secret')
		for (const item of [
			`offers:2@${itemRefSignature(key, 'offers:1')}`,
			`offers:1@${itemRefSignature(otherKey, 'offers:1')}`,
			flipLast(signed('offers:1')),
			`${signed('offers:1')}A`,
			`${signed('offers:1').slice(0, -1)}`,
			'offers:1@',
			'offers:1@!!!!!!!!!!!!',
		]) {
			const event = await normalize({ type: 'event', name: 'x', path: '/p', item })
			expect(event.type).toBe('event')
			expect(event.item).toBeUndefined()
		}
	})

	it('keeps an unsigned ref where signatures are optional, but never a tampered one', async () => {
		const optional: ItemIngestOptions = { ...items, signature: { mode: 'optional', key } }
		const unsigned = await normalize(
			{ type: 'event', name: 'x', path: '/p', item: 'offers:1' },
			optional
		)
		const signedOne = await normalize(
			{ type: 'event', name: 'x', path: '/p', item: signed('offers:1') },
			optional
		)
		const tampered = await normalize(
			{
				type: 'event',
				name: 'x',
				path: '/p',
				item: `offers:2@${itemRefSignature(key, 'offers:1')}`,
			},
			optional
		)
		expect(unsigned.item).toBe('offers:1')
		expect(signedOne.item).toBe('offers:1')
		expect(tampered.item).toBeUndefined()
	})

	it('verifies nothing a page sends without a key, and still keeps server code’s own items', async () => {
		const keyless: ItemIngestOptions = { collections: new Set(['offers']) }
		const page = await normalize(
			{ type: 'event', name: 'x', path: '/p', item: signed('offers:1') },
			keyless
		)
		const server = await fromServer(
			{ type: 'goal', name: 'purchase', path: '/orders', item: 'offers:1' },
			keyless
		)
		expect(page.item).toBeUndefined()
		expect(server.item).toBe('offers:1')
	})

	it('keeps a signed id holding an @, which its ref writes as %40', async () => {
		const event = await normalize({
			type: 'event',
			name: 'x',
			path: '/p',
			item: signed('offers:a%40b'),
		})
		expect(event.item).toBe('offers:a%40b')
		const raw = await normalize({
			type: 'event',
			name: 'x',
			path: '/p',
			item: `offers:a@b@${itemRefSignature(key, 'offers:a@b')}`,
		})
		expect(raw.item).toBeUndefined()
	})

	it('drops an item of another collection, a malformed one, or any on an unbound install, keeping the event', async () => {
		for (const [item, options] of [
			[signed('pages:1'), items],
			[signed('offers'), items],
			[signed('offers:a b'), items],
			[signed('offers:1'), null],
		] as const) {
			const event = await normalize({ type: 'event', name: 'x', path: '/p', item }, options)
			expect(event.type).toBe('event')
			expect(event.item).toBeUndefined()
		}
	})

	// Kept beside signatures: a ref the server signed for an id its collection could not hold would
	// otherwise reach the label reads, where one id the database cannot cast fails the whole lookup.
	it('drops a ref whose id the database could not cast, keeping the event and the other refs', async () => {
		const objectIds: ItemIngestOptions = {
			...items,
			idTypes: new Map([['offers', 'objectId' as const]]),
		}
		const real = 'offers:65f0c0ffee0123456789abcd'
		const click = await normalize(
			{ type: 'event', name: 'item_click', path: '/p', item: signed('offers:x') },
			objectIds
		)
		expect(click.type).toBe('event')
		expect(click.item).toBeUndefined()
		const seen = await normalize(
			{
				type: 'engagement',
				path: '/p',
				impressions: [signed('offers:x'), signed(real), signed('offers:42')],
			},
			objectIds
		)
		expect(seen.impressions).toEqual([real])
		const forged = await normalize(
			{ type: 'engagement', path: '/p', durationMs: 2000, impressions: [signed('offers:x')] },
			objectIds
		)
		expect(forged.durationMs).toBe(2000)
		expect(forged).not.toHaveProperty('impressions')
	})

	it('keeps no item on a pageview or an engagement', async () => {
		const pageview = await normalize({ type: 'pageview', path: '/p', item: signed('offers:1') })
		const engagement = await normalize({
			type: 'engagement',
			path: '/p',
			durationMs: 2000,
			item: signed('offers:1'),
		})
		expect(pageview.item).toBeUndefined()
		expect(engagement.item).toBeUndefined()
	})

	it('keeps the items an engagement saw: signed, bound, once each, at most a beacon full', async () => {
		const seen = [
			signed('offers:1'),
			signed('offers:1'),
			signed('pages:1'),
			'offers:999',
			7,
			...Array.from({ length: 60 }, (_, index) => signed(`offers:${index + 2}`)),
		]
		const event = await normalize({ type: 'engagement', path: '/p', impressions: seen })
		expect(event.impressions?.[0]).toBe('offers:1')
		expect(event.impressions).toHaveLength(MAX_ITEMS_PER_BEACON)
		expect(new Set(event.impressions).size).toBe(MAX_ITEMS_PER_BEACON)
		expect(event.impressions).not.toContain('pages:1')
		expect(event.impressions).not.toContain('offers:999')
	})

	it('keeps the items seen on an engagement alone', async () => {
		const goal = await normalize({
			type: 'goal',
			name: 'book-demo',
			path: '/p',
			impressions: [signed('offers:1')],
		})
		expect(goal.impressions).toBeUndefined()
		const notAList = await normalize({
			type: 'engagement',
			path: '/p',
			impressions: signed('offers:1'),
		})
		expect(notAList.impressions).toBeUndefined()
	})

	// A server sale's path is where it was recorded (`/orders`), not a page anyone saw it on:
	// aggregation leaves server hits out of the pages an item was seen on.
	it("marks a server event carrying an item as server code's, a page's click as no such", async () => {
		const sale = await fromServer({
			type: 'goal',
			name: 'purchase',
			path: '/orders',
			item: 'offers:1',
		})
		expect(sale).toMatchObject({ item: 'offers:1', server: true })
		expect(stored(sale)).toMatchObject({ item: 'offers:1', server: true })
		const click = await normalize({
			type: 'event',
			name: 'item_click',
			path: '/p',
			item: signed('offers:1'),
		})
		expect(click).not.toHaveProperty('server')
		expect(stored(click)).toMatchObject({ item: 'offers:1', server: false })
	})
})

describe('normalizeEvent for the hit store', () => {
	const at = new Date('2026-10-06T09:00:00.000Z')
	const visitor = { 'x-real-ip': '9.9.9.9', 'user-agent': 'UA' }
	const normalize = (
		raw: RawEventInput,
		h: Record<string, string> = visitor,
		origin: 'wire' | 'server' = 'wire'
	) =>
		normalizeEvent({
			raw,
			hostname: 'site.com',
			headers: headers(h),
			geoResolver: noopResolver,
			salt: 'salt-1',
			now: at,
			origin,
		})

	it("keys the visitor by 16 characters of the same day's hash, on every type alike", async () => {
		const pageview = await normalize({ type: 'pageview', path: '/' })
		const engagement = await normalize({ type: 'engagement', path: '/', durationMs: 1000 })
		const other = await normalize(
			{ type: 'pageview', path: '/' },
			{ ...visitor, 'x-real-ip': '8.8.8.8' }
		)
		expect(pageview.visitorId).toMatch(/^[A-Za-z0-9_-]{16}$/)
		expect(engagement.visitorId).toBe(pageview.visitorId)
		expect(other.visitorId).not.toBe(pageview.visitorId)
		expect(JSON.stringify(pageview)).not.toContain('9.9.9.9')
	})

	it('belongs to no visitor for a server event with neither an address nor an agent of its own', async () => {
		const goal: RawEventInput = { type: 'goal', name: 'signup', path: '/' }
		const anonymous = await normalize(goal, { 'user-agent': SERVER_USER_AGENT }, 'server')
		expect(anonymous.visitorId).toBe('')
		expect(anonymous.server).toBe(true)
		const addressed = await normalize(
			goal,
			{ 'user-agent': SERVER_USER_AGENT, 'x-real-ip': '9.9.9.9' },
			'server'
		)
		const agent = await normalize(goal, { 'user-agent': 'UA' }, 'server')
		expect(addressed.visitorId).toHaveLength(16)
		expect(agent.visitorId).toHaveLength(16)
		expect(await normalize(goal)).not.toHaveProperty('server')
	})

	it('keeps the click id the query carried by name, never its value', async () => {
		const paid = await normalize({
			type: 'pageview',
			path: '/',
			query: 'utm_source=news&fbclid=FB-SECRET&GCLID=G-SECRET',
		})
		expect(paid.clickId).toBe('gclid')
		expect(stored(paid).channel).toBe('paid-search')
		expect(JSON.stringify(paid)).not.toMatch(/SECRET/)
		const social = await normalize({ type: 'pageview', path: '/', query: 'fbclid=x' })
		expect(social.clickId).toBe('fbclid')
		const blank = await normalize({ type: 'pageview', path: '/', query: 'gclid=' })
		expect(blank).not.toHaveProperty('clickId')
	})

	it('marks a pageview a single-page app made in place, on `nav: 1` alone', async () => {
		expect((await normalize({ type: 'pageview', path: '/', nav: 1 })).navigation).toBe(true)
		for (const nav of [0, 2, '1', true, null]) {
			const pageview = await normalize({ type: 'pageview', path: '/', nav } as never)
			expect(pageview).not.toHaveProperty('navigation')
		}
		const event = await normalize({ type: 'event', name: 'signup', path: '/', nav: 1 })
		expect(event).not.toHaveProperty('navigation')
	})

	it('changes nothing else of a pageview that says it is a navigation, which opens no visit', async () => {
		const referrer = 'https://news.example/story'
		const loaded = await normalize({ type: 'pageview', path: '/', referrer })
		const navigated = await normalize({ type: 'pageview', path: '/', referrer, nav: 1 })
		const { navigation: _navigation, ...rest } = navigated
		expect(rest).toEqual(loaded)
		expect(stored(loaded)).toMatchObject({ landing: true, ref: 'news.example' })
		expect(stored(navigated)).toMatchObject({ landing: false, source: 'direct' })
	})
})
