import { describe, expect, it } from 'vitest'
import { dayWindow, planAggregateRead } from '../aggregate'
import { DEFAULT_CAPS, resolveCaps } from '../caps'
import { TWIN_WINDOW_MS } from '../hits'
import type { AggregateRead } from '../types'
import {
	aggregateReadPipeline,
	dayAggregationPipeline,
	dayHitsPipeline,
	dayRowsFilter,
	SET_FOLD_HITS,
} from './aggregatePipelines'
import { goldenJson } from './goldenJson'
import { type Stage, type TwinLookup, twinStages } from './pipelines'

const WINDOW = dayWindow('tenant-a', 20261006, 'Europe/Berlin')

const TWINS: TwinLookup = { from: 'analytics-hits', windowMs: TWIN_WINDOW_MS }

const names = (pipeline: Stage[]): string[] => pipeline.map((stage) => Object.keys(stage)[0] ?? '')

/** A day's pipeline folded in sets, with item pages and the default caps unless overridden. */
const dayPipeline = (
	overrides: Partial<Parameters<typeof dayAggregationPipeline>[1]> = {},
	window = WINDOW
): Stage[] =>
	dayAggregationPipeline(window, {
		itemPages: true,
		fold: 'sets',
		twins: TWINS,
		caps: DEFAULT_CAPS,
		...overrides,
	})

/** One run writes one day, so each completed day's generation is its own. */
const GENS = ['G1', 'G2', 'G3']

const READS: ReadonlyArray<[string, AggregateRead]> = [
	[
		'aggregate-top-pages',
		{
			scope: 'tenant-a',
			days: [[20261001, 20261030]],
			dim: 'page',
			groupBy: 'value',
			order: { part: 'pageviews', dir: 'desc' },
			limit: 10,
		},
	],
	[
		'aggregate-goal-sources-filled',
		{
			days: [[20261001, 20261030]],
			dim: 'goal',
			value: 'purchase',
			dim2: 'source',
			groupBy: 'value2',
			values: ['google', 'bing'],
			order: { part: 'revenue', per: 'conversions', dir: 'desc' },
		},
	],
	[
		'aggregate-item-series',
		{ scope: 'tenant-a', days: [[20261001, 20261003]], dim: 'item', groupBy: 'day' },
	],
]

describe('aggregation pipeline goldens', () => {
	for (const fold of ['sets', 'visitors'] as const) {
		it(`a day's read folded in ${fold}`, async () => {
			await expect(goldenJson(dayPipeline({ fold }))).toMatchFileSnapshot(
				`./__golden__/day-aggregation-${fold}.json`
			)
		})
	}
	for (const [name, read] of READS) {
		it(name, async () => {
			await expect(
				goldenJson(aggregateReadPipeline(planAggregateRead(read), GENS))
			).toMatchFileSnapshot(`./__golden__/${name}.json`)
		})
	}
})

describe('aggregation pipeline shape', () => {
	it('reads the day once off the (scope, ts) index, cutting visits with their totals', () => {
		const pipeline = dayPipeline()
		const window = { scope: 'tenant-a', ts: { $gte: WINDOW.start, $lt: WINDOW.end } }
		expect(pipeline[0]).toEqual({ $match: { ...window, _id: { $not: { $gte: 'o', $lt: 'p' } } } })
		expect(pipeline[1]).toEqual({
			$unionWith: {
				coll: 'analytics-hits',
				pipeline: [{ $match: { ...window, _id: { $gte: 'o', $lt: 'p' } } }, ...twinStages(TWINS)],
			},
		})
		expect(names(pipeline).filter((name) => name === '$setWindowFields')).toHaveLength(5)
		expect(JSON.stringify(pipeline)).toContain('"v_act"')
		expect(dayHitsPipeline(WINDOW)).toEqual([{ $match: window }, { $count: 'n' }])
	})

	it('carries no list of orders, so the pipeline is the same size however many a day holds', () => {
		const textOf = (window: typeof WINDOW) => JSON.stringify(dayPipeline({}, window))
		const text = textOf(WINDOW)
		expect(textOf(dayWindow('tenant-a', 20261007, 'Europe/Berlin'))).toHaveLength(text.length)
		expect(text.length).toBeLessThan(256 * 1024)
		expect(text).not.toContain('$literal')
		expect(text).not.toContain('"$nin"')
	})

	it('folds a small day in one group, a big one per visitor and then per row', () => {
		const sets = dayPipeline()
		const visitors = dayPipeline({ fold: 'visitors' })
		expect(names(sets).filter((name) => name === '$group')).toHaveLength(2)
		expect(names(visitors).filter((name) => name === '$group')).toHaveLength(3)
		expect(SET_FOLD_HITS * 56).toBeLessThan(16 * 1024 * 1024)
	})

	it('leaves the item by page facts out when the install keeps no item pages', () => {
		expect(JSON.stringify(dayPipeline())).toContain('"k":24')
		expect(JSON.stringify(dayPipeline({ itemPages: false }))).not.toContain('"k":24')
	})

	it('bounds a day’s rows by every kind’s dimensions, as the aggregates index reads', () => {
		expect(dayRowsFilter(WINDOW)).toEqual({
			scope: 'tenant-a',
			day: 20261006,
			dim: { $in: expect.arrayContaining(['', 'page', 'item', 'goal', 'source']) },
			dim2: { $in: ['', 'channel', 'source', 'utmCampaign', 'page'] },
		})
	})

	it('reads only the generations the days completed, the days bounded as the index reads', () => {
		const [name, read] = READS[0] ?? ['', { days: [], dim: '', groupBy: 'total' }]
		expect(name).toBe('aggregate-top-pages')
		expect(aggregateReadPipeline(planAggregateRead(read), GENS)[0]).toMatchObject({
			$match: {
				scope: 'tenant-a',
				day: { $gte: 20261001, $lte: 20261030 },
				gen: { $in: GENS },
			},
		})
		const split = {
			...read,
			days: [
				[20261001, 20261003],
				[20261010, 20261012],
			] as const,
		}
		expect(aggregateReadPipeline(planAggregateRead(split), GENS)[0]).toMatchObject({
			$match: {
				day: { $gte: 20261001, $lte: 20261012 },
				$or: [
					{ day: { $gte: 20261001, $lte: 20261003 } },
					{ day: { $gte: 20261010, $lte: 20261012 } },
				],
			},
		})
	})

	it('names one generation per completed day however many scopes a read covers', () => {
		const shares = Array.from({ length: 1_000 }, (_, scope) => `G${scope}`)
		const text = JSON.stringify(
			aggregateReadPipeline(
				planAggregateRead({
					scopes: shares.map((_, scope) => `t${scope}`),
					days: [[20261001, 20261030]],
					dim: '',
					groupBy: 'total',
				}),
				shares
			)
		)
		expect(text.match(/"\$or"/g) ?? []).toHaveLength(0)
		expect(text.length).toBeLessThan(64 * 1024)
	})

	it('caps each kind in the pipeline, and adds no stage when no kind is capped', () => {
		const capped = dayPipeline()
		const uncapped = dayPipeline({
			caps: resolveCaps(Object.fromEntries(Object.keys(DEFAULT_CAPS).map((key) => [key, null]))),
		})
		expect(names(capped).slice(-4)).toEqual(['$set', '$setWindowFields', '$set', '$group'])
		expect(names(uncapped).length).toBe(names(capped).length - 4)
		expect(JSON.stringify(capped)).toContain('"documents":["unbounded","current"]')
	})
})
