import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supportsFilter } from '../../src/core/capabilities'
import type { AnalyticsFilter } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { createEventStore } from '../../src/native/store/eventStore'
import { answerRawRead } from '../../src/native/store/memory/memoryStore'
import { planRawRead } from '../../src/native/store/rawRead'
import type { EventStore, HitRow, RawRead, RawRow } from '../../src/native/store/types'
import { randomFixture } from './hitFixtures'

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

const TIMEOUT = 20_000

const FIXTURES = [
	{ seed: 41, scope: 'pre', other: 'pre-other' },
	{ seed: 20261007, scope: 'pre-b', other: 'pre-b-other' },
].map((fixture) => ({ ...fixture, ...randomFixture(fixture.seed, fixture.scope, fixture.other) }))

const HITS: HitRow[] = FIXTURES.flatMap((fixture) => fixture.hits)

const eq = (dimension: AnalyticsFilter['dimension'], value: string): AnalyticsFilter => ({
	dimension,
	operator: 'eq',
	value,
})

/**
 * Reads that keep only some visitors before cutting visits (see `VisitorCondition`), each with a
 * filter a visit's attribute or a hit's own value passes, or a window starting after its visits do.
 */
const battery = (fixture: (typeof FIXTURES)[number]): Array<[string, RawRead]> => {
	const first = fixture.days[0]
	const second = fixture.days[1]
	const fourth = fixture.days[3]
	if (!first || !second || !fourth) {
		throw new Error('the fixture covers four days')
	}
	const afternoon = new Date(second.getTime() + 14 * 3_600_000)
	const whole: RawRead = {
		scope: fixture.scope,
		start: first,
		end: fourth,
		filters: [],
		sessions: true,
		timeoutMs: TIMEOUT,
	}
	const filtered = (...filters: AnalyticsFilter[]): RawRead => ({ ...whole, filters })
	return [
		['pages of one country', { ...filtered(eq('country', 'DE')), groupBy: 'page' }],
		[
			'totals of one country by day',
			{ ...filtered(eq('country', 'FR')), buckets: [first, second] },
		],
		['sources of one page', { ...filtered(eq('page', '/pricing')), groupBy: 'source' }],
		[
			'a campaign carried into later visits',
			{ ...filtered(eq('utmCampaign', 'fall_sale')), groupBy: 'page' },
		],
		[
			'channels of a contains page',
			{
				...filtered({ dimension: 'page', operator: 'contains', value: 'BLOG' }),
				groupBy: 'channel',
			},
		],
		[
			'a matches source',
			filtered({ dimension: 'source', operator: 'matches', value: '^(google|bing)$' }),
		],
		[
			'two filters',
			{ ...filtered(eq('device', 'mobile'), eq('channel', 'organic-search')), groupBy: 'page' },
		],
		['a goal by channel', { ...filtered(eq('goal', 'purchase')), groupBy: 'channel' }],
		[
			'a goal by source, visits counted',
			{ ...filtered(eq('goal', 'any-sale')), groupBy: 'source' },
		],
		['a currency by country', { ...filtered(eq('currency', 'USD')), groupBy: 'country' }],
		['an event by country', { ...filtered(eq('event', 'download')), groupBy: 'country' }],
		['an item by country', { ...whole, item: 'offers:9', groupBy: 'country' }],
		['the server page', filtered(eq('page', '/api/webhook'))],
		[
			'one hostname of one country',
			{ ...filtered(eq('country', 'US')), hostname: 'b.example', groupBy: 'source' },
		],
		[
			'an afternoon, visits cut from midnight',
			{
				...whole,
				start: afternoon,
				end: new Date(afternoon.getTime() + 3_600_000),
				from: second,
				groupBy: 'source',
				order: { part: 'visitors', dir: 'desc' },
				limit: 5,
			},
		],
		[
			'an afternoon of one country',
			{
				...filtered(eq('country', 'DE')),
				start: afternoon,
				end: new Date(afternoon.getTime() + 3_600_000),
				from: second,
			},
		],
		[
			'every scope, one country',
			{ ...filtered(eq('country', 'DE')), scope: undefined, groupBy: 'page' },
		],
	]
}

describeForDb('native visitor prefilter', {}, (db) => {
	let booted: BootedPayload
	let store: EventStore

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: plugin() })
		store = createEventStore(booted.payload)
		expect(await store.append(HITS)).toEqual({ written: HITS.length, duplicates: 0 })
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	/** What a read answers with every visitor's visits cut first, then its facts filtered. */
	const everyVisitor = (read: RawRead): RawRow[] =>
		answerRawRead(HITS, planRawRead(read, { id: store.id, filters: store.features.filters }))

	describe.each(FIXTURES)('random fixture $seed', (fixture) => {
		const counted: boolean[] = []
		for (const [name, read] of battery(fixture)) {
			it(`answers ${name} as cutting every visitor's visits first`, async () => {
				if (read.filters.some((filter) => !supportsFilter(store.features, filter))) {
					return
				}
				const plan = planRawRead(read, { id: store.id, filters: store.features.filters })
				expect(plan.visitors.length).toBeGreaterThan(0)
				const expected = everyVisitor(read)
				expect(await store.readRaw(read)).toEqual(expected)
				counted.push(
					expected.some((row) => (row.parts.pageviews ?? 0) + (row.parts.events ?? 0) > 0)
				)
			})
		}

		it('counted something in nearly every one of those reads', () => {
			expect(counted.filter(Boolean).length).toBeGreaterThanOrEqual(counted.length - 3)
		})

		it("ranks the live window's sources over the visitors active in it alone", async () => {
			const second = fixture.days[1]
			if (!second) {
				throw new Error('the fixture covers four days')
			}
			const start = new Date(second.getTime() + 15 * 3_600_000)
			const end = new Date(start.getTime() + 30 * 60_000)
			const live = await store.realtime({
				scope: fixture.scope,
				start,
				end,
				from: second,
				parts: ['sources'],
				timeoutMs: TIMEOUT,
			})
			const sources = everyVisitor({
				scope: fixture.scope,
				start,
				end,
				from: second,
				filters: [],
				sessions: false,
				groupBy: 'source',
				order: { part: 'visitors', dir: 'desc' },
				limit: 10,
				timeoutMs: TIMEOUT,
			})
			expect(live.sources).toEqual(
				sources.map((row) => ({
					value: row.value,
					visitors: row.parts.visitors,
					pageviews: row.parts.pageviews,
				}))
			)
			expect(live.minutes).toEqual([])
			expect(live.pages).toEqual([])
		})
	})

	it('counts a window no further than one past its bound', async () => {
		const [fixture] = FIXTURES
		const first = fixture?.days[0]
		const fourth = fixture?.days[3]
		if (!fixture || !first || !fourth) {
			throw new Error('no fixture')
		}
		const window = { scope: fixture.scope, start: first, end: fourth }
		const held = HITS.filter(
			(hit) => hit.scope === fixture.scope && hit.ts >= first && hit.ts < fourth
		).length
		expect(await store.countHits(window, held + 100)).toBe(held)
		expect(await store.countHits(window, 10)).toBe(11)
		expect(await store.countHits(window, 0)).toBe(1)
		expect(await store.countHits({ ...window, scope: 'nobody' }, 10)).toBe(0)
	})
})
