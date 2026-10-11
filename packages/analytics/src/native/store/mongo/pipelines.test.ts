import { describe, expect, it } from 'vitest'
import { TWIN_WINDOW_MS } from '../hits'
import { planRawRead, rawFilterMap } from '../rawRead'
import type { RawRead } from '../types'
import { goldenJson as golden } from './goldenJson'
import {
	keptVisitorsPipeline,
	rawReadPipeline,
	type Stage,
	type TwinLookup,
	twinStages,
} from './pipelines'

const DAY = new Date('2026-10-06T00:00:00.000Z')
const NEXT = new Date('2026-10-07T00:00:00.000Z')
const hour = (h: number): Date => new Date(DAY.getTime() + h * 3_600_000)

const TWINS: TwinLookup = { from: 'analytics-hits', windowMs: TWIN_WINDOW_MS }

const base: RawRead = {
	scope: 'tenant-a',
	start: DAY,
	end: NEXT,
	filters: [],
	sessions: false,
	timeoutMs: 5000,
}

const READS: ReadonlyArray<[string, RawRead]> = [
	['total', base],
	['visits-by-hour', { ...base, sessions: true, buckets: [hour(0), hour(6), hour(12), hour(18)] }],
	[
		'sources-filtered-top',
		{
			...base,
			from: DAY,
			start: hour(9),
			hostname: 'a.example',
			sessions: true,
			groupBy: 'source',
			filters: [
				{ dimension: 'source', operator: 'contains', value: '50%_Off.' },
				{ dimension: 'page', operator: 'matches', value: '^/pri' },
			],
			order: { part: 'pageviews', dir: 'desc' },
			limit: 5,
		},
	],
	[
		'goals-by-channel',
		{
			...base,
			groupBy: 'channel',
			filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
		},
	],
	['item-pages', { ...base, item: 'offers:1', groupBy: 'page' }],
	[
		'pages-filled-by-time-per-view',
		{
			...base,
			groupBy: 'page',
			values: ['/a', '/b'],
			order: { part: 'durationMs', per: 'pageviews', dir: 'desc' },
		},
	],
]

const planOf = (read: RawRead) =>
	planRawRead(read, { id: 'mongo', filters: rawFilterMap(['eq', 'contains', 'matches']) })

const pipelineOf = (read: RawRead): Stage[] => rawReadPipeline(planOf(read), TWINS)

const stageNames = (pipeline: Stage[]): string[] =>
	pipeline.map((stage) => Object.keys(stage)[0] ?? '')

describe('rawReadPipeline goldens', () => {
	for (const [name, read] of READS) {
		it(name, async () => {
			await expect(golden(pipelineOf(read))).toMatchFileSnapshot(`./__golden__/${name}.json`)
		})
	}
})

describe('visitor prefilter goldens', () => {
	const country: RawRead = {
		...base,
		groupBy: 'page',
		filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
		order: { part: 'pageviews', dir: 'desc' },
		limit: 10,
	}
	const live: RawRead = {
		...base,
		from: DAY,
		start: hour(18),
		end: new Date(hour(18).getTime() + 30 * 60_000),
		groupBy: 'source',
		order: { part: 'visitors', dir: 'desc' },
		limit: 10,
	}

	it('lists the visitors of a country, then cuts their visits alone', async () => {
		const plan = planOf(country)
		const [condition] = plan.visitors
		if (!condition) {
			throw new Error('a filtered read keeps the visitors of its filter')
		}
		await expect(
			golden([
				...keptVisitorsPipeline(plan, condition, 100_000),
				...rawReadPipeline(plan, TWINS, [
					{ hostname: 'a.example', ids: ['V1', 'V2'] },
					{ hostname: 'b.example', ids: ['V3'] },
				]),
			])
		).toMatchFileSnapshot('./__golden__/pages-of-a-country.json')
	})

	it('lists the visitors active in a live window, across scopes by scope', async () => {
		const plan = planOf({ ...live, scope: undefined })
		const [condition] = plan.visitors
		if (!condition) {
			throw new Error('a live read keeps the visitors active in its window')
		}
		await expect(
			golden([
				...keptVisitorsPipeline(plan, condition, 100_000),
				...rawReadPipeline(plan, TWINS, [
					{ scope: 'tenant-a', hostname: 'a.example', ids: ['V1'] },
				]),
			])
		).toMatchFileSnapshot('./__golden__/live-sources.json')
	})

	it('matches the hit itself for each kind of filter', () => {
		const first = (filter: RawRead['filters'][number]) => {
			const plan = planOf({ ...base, sessions: true, filters: [filter] })
			const [condition] = plan.visitors
			return condition ? keptVisitorsPipeline(plan, condition, 10)[0] : undefined
		}
		const match = (filter: RawRead['filters'][number]) => JSON.stringify(first(filter))
		expect(match({ dimension: 'goal', operator: 'eq', value: 'purchase' })).toContain(
			'"$or":[{"goals.slug":"purchase"},{"_id":{"$gte":"ow.","$lt":"ow/"}}]'
		)
		expect(match({ dimension: 'item', operator: 'eq', value: 'offers:1' })).toContain(
			'"$or":[{"item":"offers:1"},{"impressions":"offers:1"}]'
		)
		expect(match({ dimension: 'currency', operator: 'eq', value: 'USD' })).toContain(
			'"$or":[{"originalCurrency":"USD"},{"originalCurrency":null,"currency":"USD"}]'
		)
		expect(match({ dimension: 'event', operator: 'contains', value: 'sign' })).toContain(
			'"type":"event","name":{"$regex":"sign","$options":"i"}'
		)
		expect(match({ dimension: 'referrer', operator: 'eq', value: 'google.com' })).toContain(
			'"ref":"google.com"'
		)
		expect(keptVisitorsPipeline(planOf(country), { start: DAY }, 7).at(-1)).toEqual({ $limit: 8 })
	})
})

describe('rawReadPipeline shape', () => {
	it("joins the window's orders in with their twins looked up by _id, before anything reads a sale", () => {
		const stages = rawReadPipeline(planOf({ ...base, sessions: true }), TWINS)
		const window = { scope: 'tenant-a', ts: { $gte: DAY, $lt: NEXT } }
		expect(stages[0]).toEqual({ $match: { ...window, _id: { $not: { $gte: 'o', $lt: 'p' } } } })
		expect(stageNames(stages).slice(0, 3)).toEqual(['$match', '$unionWith', '$project'])
		const union = stages[1]?.$unionWith as { coll: string; pipeline: Stage[] }
		expect(union.coll).toBe('analytics-hits')
		expect(union.pipeline[0]).toEqual({ $match: { ...window, _id: { $gte: 'o', $lt: 'p' } } })
		expect(stageNames(union.pipeline)).toEqual([
			'$match',
			'$set',
			'$lookup',
			'$set',
			'$match',
			'$set',
			'$set',
			'$unset',
		])
		expect(union.pipeline[2]).toEqual({
			$lookup: {
				from: 'analytics-hits',
				localField: 'tid',
				foreignField: '_id',
				pipeline: [
					{
						$project: {
							ts: 1,
							item: 1,
							conversions: 1,
							revenue: 1,
							goals: 1,
							value: 1,
							originalValue: 1,
							currency: 1,
							originalCurrency: 1,
						},
					},
				],
				as: 'tw',
			},
		})
	})

	it('names either record of an order its twin, and credits one within the window alone', () => {
		const [named, , , dropped, credited] = twinStages(TWINS)
		const text = JSON.stringify(named)
		expect(text).toContain('{"$concat":["os.",')
		expect(text).toContain('{"$concat":["ow.",')
		const close = '{"$lte":[{"$abs":{"$subtract":["$tw.ts","$ts"]}},86400000]}'
		expect(JSON.stringify(dropped)).toContain(close)
		expect(JSON.stringify(credited)).toContain(close)
		const anyDistance = JSON.stringify(twinStages({ from: 'analytics-hits', windowMs: null }))
		expect(anyDistance).not.toContain('$abs')
	})

	it('starts on the (scope, ts) index, from `from` when it cuts visits', () => {
		const notOrders = { _id: { $not: { $gte: 'o', $lt: 'p' } } }
		expect(pipelineOf({ ...base, start: hour(9), from: DAY, sessions: true })[0]).toEqual({
			$match: { scope: 'tenant-a', ts: { $gte: DAY, $lt: NEXT }, ...notOrders },
		})
		expect(pipelineOf({ ...base, start: hour(9), from: DAY })[0]).toEqual({
			$match: { scope: 'tenant-a', ts: { $gte: hour(9), $lt: NEXT }, ...notOrders },
		})
	})

	it('cuts visits with three windows, a fourth to carry a landing, the gap by time and then _id', () => {
		const windowsOf = (read: RawRead) =>
			pipelineOf(read).filter((stage) => '$setWindowFields' in stage)
		expect(windowsOf({ ...base, groupBy: 'country' })).toHaveLength(3)
		expect(windowsOf({ ...base, groupBy: 'source' })).toHaveLength(4)
		const windows = windowsOf({ ...base, sessions: true })
		expect(windows).toHaveLength(3)
		expect(windows[0]).toEqual({
			$setWindowFields: {
				partitionBy: { s: '$scope', h: '$hostname', v: '$v' },
				sortBy: { ts: 1, _id: 1 },
				output: { prevAct: { $max: '$act', window: { documents: ['unbounded', -1] } } },
			},
		})
		expect(stageNames(pipelineOf(base))).not.toContain('$setWindowFields')
	})

	it('carries only the attributes a read takes, on the hits that are no engagement', () => {
		const projected = (read: RawRead) =>
			JSON.stringify(pipelineOf(read).find((stage) => '$project' in stage))
		expect(projected({ ...base, sessions: true })).not.toContain('"a":')
		const countries = projected({ ...base, groupBy: 'country' })
		expect(countries).toContain(
			'"a":{"$cond":[{"$eq":["$type","engagement"]},"$$REMOVE",{"country":"$country"}]}'
		)
		expect(JSON.stringify(pipelineOf({ ...base, groupBy: 'country' }))).not.toContain('e_source')
	})

	it('counts distinct visits and visitors by grouping three times, never by collecting sets', () => {
		const names = stageNames(pipelineOf({ ...base, sessions: true }))
		expect(names.filter((name) => name === '$group')).toHaveLength(3)
		expect(JSON.stringify(pipelineOf({ ...base, sessions: true }))).not.toContain('$addToSet')
		expect(stageNames(pipelineOf(base)).filter((name) => name === '$group')).toHaveLength(2)
	})

	it('escapes a contains needle and leaves a matches pattern as it is, both ignoring case', () => {
		const pipeline = JSON.stringify(pipelineOf(READS[2]?.[1] ?? base))
		expect(pipeline).toContain('{"$regex":"50%_Off\\\\.","$options":"i"}')
		expect(pipeline).toContain('{"$regex":"^/pri","$options":"i"}')
	})

	it('unwinds goals for a goal read and item facts for an item read', () => {
		expect(stageNames(pipelineOf(READS[3]?.[1] ?? base))).toContain('$unwind')
		expect(JSON.stringify(pipelineOf(READS[3]?.[1] ?? base))).toContain('"$unwind":"$goals"')
		expect(JSON.stringify(pipelineOf(READS[4]?.[1] ?? base))).toContain('"$unwind":"$facts"')
	})

	it('projects the one bucket of a single-day series as a literal, never as an exclusion flag', () => {
		const folded = (read: RawRead) =>
			pipelineOf(read)
				.filter((stage) => '$project' in stage)
				.at(-1)
		expect(folded({ ...base, buckets: [DAY] })).toMatchObject({
			$project: { _id: 0, b: { $literal: 0 } },
		})
		expect(JSON.stringify(folded({ ...base, buckets: [DAY, hour(12)] }))).toContain(
			'"b":{"$cond":[{"$lt":["$ts"'
		)
	})

	it('ranks with rows that have nothing to rank last, then by value, then limits', () => {
		const pipeline = pipelineOf(READS[2]?.[1] ?? base)
		expect(pipeline.at(-2)).toEqual({ $sort: { unranked: 1, rank: -1, '_id.g': 1 } })
		expect(pipeline.at(-1)).toEqual({ $limit: 5 })
	})
})
