import { describe, expect, it } from 'vitest'
import type { Goal } from '../../goals/types'
import { noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { SERVER_USER_AGENT } from './device'
import { MAX_QUERY_LENGTH, normalizeEvent } from './normalizeEvent'

const headers = (h: Record<string, string>) => new Headers(h)

describe('normalizeEvent', () => {
	it('builds a stored event with geo, hash, and no ip', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/pricing', hostname: 'site.com', durationMs: 1200 },
			headers: headers({
				'x-vercel-ip-country': 'US',
				'x-forwarded-for': '9.9.9.9',
				'user-agent': 'UA',
			}),
			geoResolver: platformHeaderResolver,
			salt: 'salt-1',
			now: new Date('2026-01-01T10:15:00Z'),
		})
		expect(ev.type).toBe('pageview')
		expect(ev.path).toBe('/pricing')
		expect(ev.country).toBe('US')
		expect(ev.durationMs).toBe(1200)
		expect(ev.visitorHash).toMatch(/^[a-f0-9]{64}$/)
		expect(ev.sessionId).toHaveLength(32)
		expect(JSON.stringify(ev)).not.toContain('9.9.9.9')
		expect(ev.timestamp.toISOString()).toBe('2026-01-01T10:15:00.000Z')
	})
	it('honors a noop geo resolver', async () => {
		const ev = await normalizeEvent({
			raw: { type: 'pageview', path: '/', hostname: 'site.com' },
			headers: headers({ 'x-vercel-ip-country': 'US', 'user-agent': 'UA' }),
			geoResolver: noopResolver,
			salt: 's',
			now: new Date('2026-01-01T00:00:00Z'),
		})
		expect(ev.country).toBeUndefined()
	})

	it('derives device from the user-agent header and source from the referrer', async () => {
		const event = await normalizeEvent({
			raw: {
				type: 'pageview',
				path: '/p',
				hostname: 'example.com',
				referrer: 'https://www.google.com/',
			},
			headers: new Headers({
				'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148',
			}),
			geoResolver: async () => ({}),
			salt: 'salt',
			now: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect(event.device).toBe('mobile')
		expect(event.source).toBe('google.com')
	})

	it('omits device entirely for a user agent that is not a device', async () => {
		const event = await normalizeEvent({
			raw: { type: 'pageview', path: '/p', hostname: 'example.com' },
			headers: new Headers({ 'user-agent': SERVER_USER_AGENT }),
			geoResolver: async () => ({}),
			salt: 'salt',
			now: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect('device' in event).toBe(false)
	})
})

describe('normalizeEvent contract growth', () => {
	const build = async (raw: Record<string, unknown>, goals?: Goal[]) =>
		normalizeEvent({
			raw: raw as never,
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

	it('drops a durationMs past the 24 hour ceiling', async () => {
		const duration = async (durationMs: unknown) =>
			(await build({ type: 'pageview', path: '/x', hostname: 'h', durationMs })).durationMs
		expect(await duration(86_400_000)).toBe(86_400_000)
		expect(await duration(86_400_001)).toBeUndefined()
	})

	it('caps path and hostname, which are unique-index bucket keys', async () => {
		const ev = await build({
			type: 'pageview',
			path: `/${'p'.repeat(900)}`,
			hostname: `${'h'.repeat(300)}.test`,
		})
		expect(ev.path).toHaveLength(512)
		expect(ev.hostname).toHaveLength(253)
	})

	it('truncates the event name, which is a rollup bucket key', async () => {
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

describe('normalizeEvent native dimensions', () => {
	const CHROME_UA =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

	const build = async (raw: Record<string, unknown>, h: Record<string, string>) =>
		normalizeEvent({
			raw: raw as never,
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

	it('stores the referrer host beside the raw referrer, and neither when there is none', async () => {
		const ev = await build(
			{
				type: 'pageview',
				path: '/p',
				hostname: 'site.com',
				referrer: 'https://www.example.org/path?x=1',
			},
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.referrer).toBe('https://www.example.org/path?x=1')
		expect(ev.referrerHost).toBe('example.org')

		const direct = await build(
			{ type: 'pageview', path: '/p', hostname: 'site.com' },
			{ 'user-agent': CHROME_UA }
		)
		expect('referrerHost' in direct).toBe(false)
	})

	it('keeps a self-referrer host, which the source channel reports as Direct', async () => {
		const ev = await build(
			{ type: 'pageview', path: '/p', hostname: 'site.com', referrer: 'https://site.com/other' },
			{ 'user-agent': CHROME_UA }
		)
		expect(ev.referrerHost).toBe('site.com')
		expect(ev.source).toBe('Direct')
	})
})
