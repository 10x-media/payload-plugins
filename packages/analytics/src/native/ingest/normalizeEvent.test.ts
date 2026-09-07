import { describe, expect, it } from 'vitest'
import type { Goal } from '../../goals/types'
import { noopResolver, platformHeaderResolver } from '../geo/geoResolver'
import { normalizeEvent } from './normalizeEvent'

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
