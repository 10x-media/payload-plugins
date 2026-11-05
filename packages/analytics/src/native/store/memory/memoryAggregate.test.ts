import { describe, expect, it } from 'vitest'
import { dedupeKeyFor } from '../../ingest/revenue'
import { dayWindow } from '../aggregate'
import { DEFAULT_CAPS } from '../caps'
import { orderHitId, serverTwinOf } from '../ids'
import { DAY_LEASE_MS, dayKey } from '../state'
import type { AggregateRead, AggregateRun, HitRow, RawRead } from '../types'
import { memoryStateStore } from './memoryState'
import { aggregateHits, memoryEventStore } from './memoryStore'

let serial = 0

const hit = (time: string, fields: Partial<HitRow> = {}): HitRow => ({
	id: `H${String(serial++).padStart(6, '0')}`,
	scope: 's',
	ts: new Date(`2026-10-06T${time}Z`),
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'V1',
	landing: false,
	server: false,
	source: 'direct',
	channel: 'direct',
	...fields,
})

const google = { landing: true, ref: 'google.com', source: 'google', channel: 'organic-search' }

const DAY_HITS: HitRow[] = [
	hit('10:00:00.000', { ...google, utmCampaign: 'fall', country: 'DE' }),
	hit('10:00:00.010', {
		type: 'engagement',
		lastAt: new Date('2026-10-06T10:02:00.000Z'),
		durationMs: 120_000,
		impressions: ['offers:1'],
		source: undefined,
		channel: undefined,
	}),
	hit('10:03:00.000', { path: '/pricing', country: 'DE' }),
	hit('10:04:00.000', {
		type: 'goal',
		name: 'purchase',
		path: '/checkout',
		currency: 'EUR',
		conversions: 1,
		revenue: 30,
		goals: [{ slug: 'purchase', value: 30 }],
		item: 'offers:1',
	}),
	hit('11:00:00.000', { v: 'V2', path: '/pricing' }),
	hit('11:01:00.000', { v: 'V2', type: 'event', name: 'signup', path: '/pricing' }),
	hit('12:00:00.000', { v: 'V3', hostname: 'b.example', ...google }),
	hit('13:00:00.000', {
		v: '',
		server: true,
		type: 'goal',
		name: 'purchase',
		path: '/api/webhook',
		conversions: 1,
		revenue: 5,
		goals: [{ slug: 'purchase', value: 5 }],
		item: 'offers:1',
		source: undefined,
		channel: undefined,
	}),
]

const WINDOW = dayWindow('s', 20261006, 'UTC')

const RUN = (runId: string, more: Partial<AggregateRun> = {}): AggregateRun => ({
	runId,
	caps: DEFAULT_CAPS,
	status: 'provisional',
	...more,
})

const prepared = async () => {
	const state = memoryStateStore({ now: () => new Date('2026-10-08T00:00:00.000Z') })
	const store = memoryEventStore({ state })
	await store.append(DAY_HITS)
	await state.ensureMarkers([{ scope: 's', day: 20261006, tz: 'UTC' }])
	const aggregate = async (runId: string, more: Partial<AggregateRun> = {}) => {
		expect(await state.claim(dayKey('s', 20261006), runId, DAY_LEASE_MS)).toBe(true)
		return store.aggregateDay(WINDOW, RUN(runId, more))
	}
	return { state, store, aggregate }
}

const read = (more: Partial<AggregateRead> & Pick<AggregateRead, 'dim' | 'groupBy'>) => ({
	scope: 's',
	days: [[20261006, 20261006]] as const,
	...more,
})

describe('memory store day aggregation', () => {
	it('counts a day into every kind per hostname, uncapped', () => {
		const rows = aggregateHits(DAY_HITS, WINDOW, { itemPages: true })
		const of = (dim: string, dim2 = '', hostname = 'a.example') =>
			rows
				.filter(
					(row) => row.kind.dim === dim && row.kind.dim2 === dim2 && row.hostname === hostname
				)
				.map((row) => [row.value, row.value2, row.parts.pageviews ?? row.parts.impressions])
				.sort()
		expect(of('')).toEqual([['', '', 3]])
		expect(of('', '', 'b.example')).toEqual([['', '', 1]])
		expect(of('source')).toEqual([
			['direct', '', 1],
			['google', '', 2],
		])
		expect(of('utmCampaign')).toEqual([['fall', '', 2]])
		expect(of('goal', 'channel')).toEqual([['purchase', 'organic-search', 0]])
		expect(of('item')).toEqual([['offers:1', '', 1]])
		expect(of('item', 'page')).toEqual([
			['offers:1', '/', 1],
			['offers:1', '/checkout', 0],
		])
		const [site] = rows.filter((row) => row.kind.dim === '' && row.hostname === 'a.example')
		expect(site?.parts).toMatchObject({
			pageviews: 3,
			events: 3,
			visitors: 2,
			sessions: 2,
			entries: 2,
			bounces: 0,
			sessionMs: 120_000,
			conversions: 2,
			revenue: 35,
			impressions: null,
		})
	})

	it('reads completed days back as the raw hits count them', async () => {
		const { store, aggregate } = await prepared()
		expect(await aggregate('run-1')).toMatchObject({ completed: true, hits: 8 })
		const raw: RawRead = {
			scope: 's',
			start: WINDOW.start,
			end: WINDOW.end,
			filters: [],
			sessions: true,
			timeoutMs: 1000,
		}
		expect(await store.readAggregates(read({ dim: '', groupBy: 'total' }))).toEqual(
			await store.readRaw(raw)
		)
		for (const dim of ['page', 'source', 'country', 'goal', 'item', 'currency', 'event'] as const) {
			expect(await store.readAggregates(read({ dim, groupBy: 'value' })), dim).toEqual(
				await store.readRaw({ ...raw, groupBy: dim })
			)
		}
		expect(
			await store.readAggregates(
				read({ dim: 'goal', value: 'purchase', dim2: 'utmCampaign', groupBy: 'value2' })
			)
		).toEqual(
			await store.readRaw({
				...raw,
				groupBy: 'utmCampaign',
				filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
			})
		)
	})

	it('reads nothing of a day until a run completes it, and refuses a run holding no lease', async () => {
		const { store, state } = await prepared()
		expect(await store.aggregateDay(WINDOW, RUN('nobody'))).toEqual({
			completed: false,
			hits: 0,
			rows: 0,
		})
		const [empty] = await store.readAggregates(read({ dim: '', groupBy: 'total' }))
		expect(empty?.parts).toMatchObject({ pageviews: 0, visitors: 0, impressions: null })
		expect((await state.markers('s', 20261006, 20261006))[0]?.gen).toBeNull()
	})

	it('drops on a rewrite the rows the new run did not write', async () => {
		const { store, aggregate } = await prepared()
		await aggregate('run-1')
		const pages = () => store.readAggregates(read({ dim: 'page', groupBy: 'value' }))
		expect((await pages()).map((row) => row.value)).toEqual([
			'/',
			'/api/webhook',
			'/checkout',
			'/pricing',
		])
		await aggregate('run-2', { caps: { ...DEFAULT_CAPS, page: 1 } })
		// Capped per hostname: b.example has one page, a.example keeps /pricing and folds the rest
		// into an (other) row, which the page total holds and no ranking lists.
		expect(
			(await pages()).map((row) => [row.value, row.parts.pageviews, row.parts.events])
		).toEqual([
			['/', 1, 0],
			['/pricing', 2, 1],
		])
		const [total] = await store.readAggregates(read({ dim: 'page', groupBy: 'total' }))
		expect([total?.parts.pageviews, total?.parts.events]).toEqual([4, 3])
		await aggregate('run-3', { itemPages: false })
		expect(
			await store.readAggregates(
				read({ dim: 'item', value: 'offers:1', dim2: 'page', groupBy: 'value2' })
			)
		).toEqual([])
	})
})

describe('memory store day aggregation of money', () => {
	const sale = (time: string, fields: Partial<HitRow>): HitRow =>
		hit(time, { type: 'goal', name: 'purchase', path: '/checkout', currency: 'EUR', ...fields })

	it("keys currency rows by the code sent, counts refunds as no conversion, and credits a twin's sale to the browser's day", () => {
		const wire = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_1' }))
		const hits = [
			sale('10:00:00.000', {
				value: 0,
				originalValue: 80,
				originalCurrency: 'USD',
				goals: [{ slug: 'purchase', value: 0, sent: 80 }],
				conversions: 1,
				revenue: 0,
			}),
			sale('11:00:00.000', {
				v: 'V2',
				value: -10,
				goals: [{ slug: 'purchase', value: -10 }],
				conversions: 0,
				revenue: -10,
			}),
			sale('12:00:00.000', {
				id: wire,
				v: 'V3',
				value: 30,
				goals: [{ slug: 'purchase', value: 30 }],
				conversions: 1,
				revenue: 30,
			}),
			sale('09:00:00.000', {
				id: serverTwinOf(wire) ?? '',
				ts: new Date('2026-10-07T09:00:00.000Z'),
				v: '',
				server: true,
				value: 45,
				goals: [{ slug: 'purchase', value: 45 }],
				conversions: 1,
				revenue: 45,
			}),
		]
		const rows = aggregateHits(hits, WINDOW, { itemPages: true })
		const of = (dim: string) =>
			rows
				.filter((row) => row.kind.dim === dim && row.kind.dim2 === '')
				.map((row) => [row.value, row.parts.conversions, row.parts.revenue])
				.sort()
		expect(of('currency')).toEqual([
			['EUR', 1, 35],
			['USD', 1, 80],
		])
		expect(of('goal')).toEqual([['purchase', 2, 35]])
		expect(of('')).toEqual([['', 2, 35]])
		const site = rows.find((row) => row.kind.dim === '' && row.kind.dim2 === '')
		expect(site?.parts).toMatchObject({ events: 3, sessions: 3, bounces: 0 })
		const serverDay = aggregateHits(hits, dayWindow('s', 20261007, 'UTC'), { itemPages: true })
		expect(serverDay).toEqual([])
	})
})
