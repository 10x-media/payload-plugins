import { describe, expect, it } from 'vitest'
import type { AnalyticsFilter } from '../../../core/contract'
import { planRawRead, rawFilterMap } from '../rawRead'
import type { HitRow, RawRead } from '../types'
import { answerRawRead, keptVisitorsIn, memoryEventStore } from './memoryStore'

const MINUTE = 60_000
const DAY = new Date('2026-10-06T00:00:00.000Z')
const NEXT = new Date('2026-10-07T00:00:00.000Z')

/** Mulberry32, so a fixture is the same fixture every run. */
const seeded = (seed: number): (() => number) => {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const LANDINGS: ReadonlyArray<Partial<HitRow>> = [
	{ ref: 'google.com', source: 'google', channel: 'organic-search' },
	{ source: 'newsletter', channel: 'email', utmSource: 'newsletter', utmCampaign: 'fall' },
	{ source: 'direct', channel: 'direct' },
]
const PLACES = ['DE', 'US', 'FR']
const PAGES = ['/', '/pricing', '/blog/a', '/blog/b']

/**
 * A day of visitors on two hostnames: landings that later visits opened by an internal link carry
 * forward, engagements, events, item clicks and views, goals, and server hits without a visitor.
 */
const fixture = (seed: number): HitRow[] => {
	const random = seeded(seed)
	const pick = <T>(items: readonly T[]): T => {
		const item = items[Math.floor(random() * items.length)]
		if (item === undefined) {
			throw new Error('picked from nothing')
		}
		return item
	}
	const hits: HitRow[] = []
	let serial = 0
	const add = (hit: Omit<HitRow, 'id' | 'scope'>): void => {
		hits.push({ id: `P${String(serial++).padStart(6, '0')}`, scope: 's', ...hit })
	}
	for (const hostname of ['a.example', 'b.example']) {
		for (let person = 0; person < 12; person++) {
			const v = `${hostname.slice(0, 1)}${person}`.padEnd(16, 'x')
			const country = pick(PLACES)
			let clock = DAY.getTime() + Math.floor(random() * 20) * 60 * MINUTE
			for (let visit = 0; visit < 1 + Math.floor(random() * 3); visit++) {
				const steps = 1 + Math.floor(random() * 4)
				for (let step = 0; step < steps; step++) {
					const ts = new Date(clock)
					const base = { hostname, v, ts, path: pick(PAGES), server: false, country }
					const roll = random()
					if (step === 0) {
						add({
							...base,
							type: 'pageview',
							...(visit === 0 || random() < 0.3
								? { ...pick(LANDINGS), landing: true }
								: { source: 'direct', channel: 'direct', landing: false }),
						})
					} else if (roll < 0.4) {
						add({ ...base, type: 'pageview', landing: false })
					} else if (roll < 0.6) {
						add({
							...base,
							type: 'event',
							name: 'item_click',
							item: pick(['x:1', 'x:2']),
							landing: false,
						})
					} else if (roll < 0.75) {
						add({
							...base,
							type: 'goal',
							name: 'purchase',
							path: '/checkout',
							landing: false,
							conversions: 1,
							revenue: 10,
							currency: pick(['EUR', 'USD']),
							goals: [{ slug: pick(['purchase', 'signup']), value: 10 }],
						})
					} else {
						add({
							hostname,
							v,
							ts,
							lastAt: new Date(clock + 3 * MINUTE),
							path: base.path,
							type: 'engagement',
							landing: false,
							server: false,
							durationMs: 60_000,
							impressions: [pick(['x:1', 'x:2', 'x:3'])],
						})
					}
					clock += (1 + Math.floor(random() * 10)) * MINUTE
				}
				clock += (31 + Math.floor(random() * 120)) * MINUTE
			}
		}
	}
	add({
		hostname: 'a.example',
		v: '',
		ts: new Date(DAY.getTime() + 15 * 60 * MINUTE),
		path: '/api/webhook',
		type: 'goal',
		name: 'purchase',
		landing: false,
		server: true,
		conversions: 1,
		revenue: 25,
		currency: 'EUR',
		goals: [{ slug: 'purchase', value: 25 }],
	})
	return hits
}

const STORE = { id: 'memory', filters: rawFilterMap(['eq', 'contains', 'matches']) }
const AFTERNOON = new Date(DAY.getTime() + 14 * 60 * MINUTE)

const eq = (dimension: AnalyticsFilter['dimension'], value: string): AnalyticsFilter => ({
	dimension,
	operator: 'eq',
	value,
})

/** Filtered reads cutting visits, each to be answered alike with and without the visitors kept. */
const READS: ReadonlyArray<[string, Partial<RawRead>]> = [
	['pages of one country', { filters: [eq('country', 'DE')], groupBy: 'page' }],
	['sources of one page', { filters: [eq('page', '/pricing')], groupBy: 'source' }],
	['a campaign carried forward', { filters: [eq('utmCampaign', 'fall')], groupBy: 'page' }],
	[
		'two filters',
		{ filters: [eq('channel', 'organic-search'), eq('page', '/blog/a')], groupBy: 'country' },
	],
	[
		'a contains and a matches filter',
		{
			filters: [
				{ dimension: 'page', operator: 'contains', value: 'BLOG' },
				{ dimension: 'source', operator: 'matches', value: '^(google|direct)$' },
			],
		},
	],
	['a goal by channel', { filters: [eq('goal', 'purchase')], groupBy: 'channel' }],
	['a currency', { filters: [eq('currency', 'USD')], groupBy: 'source' }],
	['an item by country', { item: 'x:3', groupBy: 'country' }],
	['an event by page', { filters: [eq('event', 'item_click')], groupBy: 'page' }],
	[
		'the afternoon, visits cut from midnight',
		{ start: AFTERNOON, from: DAY, groupBy: 'source', order: { part: 'visitors', dir: 'desc' } },
	],
	[
		'the afternoon of one country by the hour',
		{
			start: AFTERNOON,
			from: DAY,
			filters: [eq('country', 'US')],
			buckets: [AFTERNOON, new Date(AFTERNOON.getTime() + 3 * 60 * MINUTE)],
		},
	],
]

describe('memory store visitor prefilter', () => {
	const hits = fixture(20261007)

	it.each(READS)('answers %s exactly as cutting every visitor first', async (_name, more) => {
		const store = memoryEventStore()
		await store.append(hits)
		const read: RawRead = {
			scope: 's',
			start: DAY,
			end: NEXT,
			filters: [],
			sessions: true,
			timeoutMs: 1000,
			...more,
		}
		const plan = planRawRead(read, STORE)
		expect(plan.visitors.length).toBeGreaterThan(0)
		const everyone = answerRawRead(hits, plan)
		expect(everyone.length).toBeGreaterThan(0)
		expect(await store.readRaw(read)).toEqual(everyone)
	})

	it('keeps fewer visitors than the window holds for a narrow filter', () => {
		const plan = planRawRead(
			{
				scope: 's',
				start: DAY,
				end: NEXT,
				filters: [eq('country', 'DE')],
				sessions: true,
				timeoutMs: 1000,
			},
			STORE
		)
		const everyone = new Set(hits.map((hit) => JSON.stringify([hit.scope, hit.hostname, hit.v])))
		const kept = keptVisitorsIn(hits, plan) ?? everyone
		expect(kept.size).toBeGreaterThan(0)
		expect(kept.size).toBeLessThan(everyone.size)
	})

	it('keeps a server hit without a visitor when its own page passes, and none for a visit filter', () => {
		const pages = planRawRead(
			{
				scope: 's',
				start: DAY,
				end: NEXT,
				filters: [eq('page', '/api/webhook')],
				sessions: true,
				timeoutMs: 1000,
			},
			STORE
		)
		expect([...(keptVisitorsIn(hits, pages) ?? [])]).toEqual([
			JSON.stringify(['s', 'a.example', '']),
		])
		const country = planRawRead({ ...pages.read, filters: [eq('country', 'BR')] }, STORE)
		expect(keptVisitorsIn(hits, country)?.size).toBe(0)
	})

	it('counts a window no further than one past its bound', async () => {
		const store = memoryEventStore()
		await store.append(hits)
		const window = { scope: 's', start: DAY, end: NEXT }
		const all = hits.length
		expect(await store.countHits(window, all + 10)).toBe(all)
		expect(await store.countHits(window, 5)).toBe(6)
		expect(await store.countHits(window, 0)).toBe(1)
		expect(await store.countHits({ ...window, scope: 'other' }, 5)).toBe(0)
		await expect(store.countHits(window, -1)).rejects.toThrow(/bounded/)
	})
})
