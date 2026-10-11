import { describe, expect, it } from 'vitest'
import { dayGenKey, dayWindow } from '../aggregate'
import { DEFAULT_CAPS } from '../caps'
import { type MongoStoreModels, mongoEventStore } from './mongoStore'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const WINDOW = dayWindow('s', 20261006, 'UTC')

interface Call {
	method: string
	args: unknown[]
}

const cursor = (docs: unknown[]) => ({ toArray: async () => docs })

const marker = (overrides: Record<string, unknown> = {}) => ({
	_id: 'day:s:20261006',
	kind: 'day',
	scope: 's',
	day: 20261006,
	tz: 'UTC',
	status: 'open',
	gen: 'G0',
	leaseOwner: 'run-1',
	leaseUntil: NOW,
	...overrides,
})

/** One row of the day's read: its key under `_id`, its parts beside. */
const factRow = (k: number, value: string, pageviews: number) => ({
	_id: { k, a: value, b: '', h: 'a.example' },
	pageviews,
	events: 0,
	visitors: pageviews,
	sessions: pageviews,
	entries: 1,
	bounces: 0,
	sessionMs: 0,
	durationMs: 0,
	scrollSum: 0,
	scrollSamples: 0,
	conversions: 0,
	revenue: 0,
	impressions: 0,
	interactions: 0,
})

/**
 * Three models that record every call, answering the state rows from `markers` and the day's read
 * from `read` (thrown when it is an error).
 */
const fakes = (state: {
	markers: () => unknown[]
	claimed?: boolean
	completed?: boolean
	read?: (pipeline: object[]) => unknown[] | Error
}) => {
	const calls: Call[] = []
	const record =
		(method: string, answer: (...args: unknown[]) => unknown) =>
		async (...args: unknown[]) => {
			calls.push({ method, args })
			return answer(...args)
		}
	const models: MongoStoreModels = {
		hits: {
			collection: {
				collectionName: 'analytics-hits',
				insertMany: record('hits.insertMany', () => ({})),
				aggregate: (pipeline: object[], options: object) => {
					calls.push({ method: 'hits.aggregate', args: [pipeline, options] })
					if (JSON.stringify(pipeline).includes('{"$count"')) {
						return cursor([{ n: 42 }])
					}
					const read = state.read?.(pipeline)
					if (read instanceof Error) {
						return {
							toArray: async () => {
								throw read
							},
						}
					}
					return cursor(read ?? [factRow(0, '', 3), factRow(16, '/a', 2), factRow(16, '/b', 1)])
				},
				findOne: record('hits.findOne', () => null),
				distinct: record('hits.distinct', () => []),
				deleteMany: record('hits.deleteMany', () => ({ deletedCount: 0 })),
				updateMany: record('hits.updateMany', () => ({ modifiedCount: 0 })),
			},
		},
		aggregates: {
			collection: {
				bulkWrite: record('aggregates.bulkWrite', () => ({})),
				deleteMany: record('aggregates.deleteMany', () => ({ deletedCount: 0 })),
				distinct: record('aggregates.distinct', () => ['G0', 'STRAY']),
				aggregate: (pipeline: object[]) => {
					calls.push({ method: 'aggregates.aggregate', args: [pipeline] })
					return cursor([{ ...factRow(16, '/a', 5), _id: '/a' }])
				},
			},
		},
		state: {
			findOneAndUpdate: record('state.findOneAndUpdate', (filter, update) => {
				// A claim or a renewal sets the lease alone; a completion writes the day's state.
				const isLease =
					JSON.stringify(filter).includes('$or') || !JSON.stringify(update).includes('"status"')
				return (isLease ? (state.claimed ?? true) : (state.completed ?? true)) ? marker() : null
			}),
			updateMany: record('state.updateMany', () => ({})),
			find: record('state.find', () => state.markers()),
			findOne: record('state.findOne', () => null),
			deleteMany: record('state.deleteMany', () => ({})),
			deleteOne: record('state.deleteOne', () => ({})),
			bulkWrite: record('state.bulkWrite', () => ({})),
			distinct: record('state.distinct', () => []),
		},
	}
	return { models, calls }
}

const RUN = { runId: 'run-1', caps: DEFAULT_CAPS, status: 'final' } as const

describe('mongoEventStore.aggregateDay', () => {
	it('notes, writes a new generation beside the readable one, completes, then drops the dead ones', async () => {
		const { models, calls } = fakes({ markers: () => [marker()] })
		const result = await mongoEventStore(() => models, { now: () => NOW }).aggregateDay(WINDOW, RUN)
		expect(result).toEqual({ completed: true, hits: 42, rows: 3 })
		expect(calls.map((call) => call.method)).toEqual([
			'state.find',
			'hits.aggregate',
			'hits.aggregate',
			'state.findOneAndUpdate',
			'state.find',
			'aggregates.distinct',
			'state.findOneAndUpdate',
			'aggregates.bulkWrite',
			'state.findOneAndUpdate',
			'aggregates.deleteMany',
			'state.deleteOne',
		])
		const note = calls[6]?.args[0]
		expect(note).toEqual({ _id: expect.stringMatching(/^drop:s:20261006:[0-9A-Z]{26}$/) })
		expect(calls.at(-1)?.args[0]).toEqual(note)
		const write = calls.find((call) => call.method === 'aggregates.bulkWrite')
		const [operations, options] = write?.args ?? []
		expect(options).toEqual({ ordered: false })
		const [first] = Array.isArray(operations) ? operations : []
		expect(first).toEqual({
			replaceOne: {
				filter: { _id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) },
				replacement: expect.objectContaining({
					scope: 's',
					day: 20261006,
					gen: expect.any(String),
				}),
				upsert: true,
			},
		})
		const drop = calls.at(-2)?.args[0]
		expect(drop).toMatchObject({ scope: 's', day: 20261006, gen: { $in: ['G0', 'STRAY'] } })
	})

	it('gives the pipelines of a count a read started what is left of its timeout, and no other count', async () => {
		const { models, calls } = fakes({ markers: () => [marker()] })
		const store = mongoEventStore(() => models, { now: () => NOW })
		await store.aggregateDay(WINDOW, { ...RUN, timeoutMs: 5_000 })
		const timed = calls
			.filter((call) => call.method === 'hits.aggregate')
			.map((call) => Reflect.get(Object(call.args[1]), 'maxTimeMS'))
		expect(timed).toHaveLength(2)
		for (const left of timed) {
			expect(left).toBeGreaterThan(4_000)
			expect(left).toBeLessThanOrEqual(5_000)
		}
		calls.length = 0
		await store.aggregateDay(WINDOW, RUN)
		expect(
			calls.filter((call) => call.method === 'hits.aggregate').map((call) => call.args[1])
		).toEqual([{ allowDiskUse: true }, { allowDiskUse: true }])
	})

	it('reads nothing and writes nothing for a run that holds no lease', async () => {
		const { models, calls } = fakes({ markers: () => [marker({ leaseOwner: 'other' })] })
		expect(await mongoEventStore(() => models).aggregateDay(WINDOW, RUN)).toEqual({
			completed: false,
			hits: 0,
			rows: 0,
		})
		expect(calls.map((call) => call.method)).toEqual(['state.find'])
	})

	it('drops its own generation when its completion is refused', async () => {
		const { models, calls } = fakes({ markers: () => [marker()], completed: false })
		const result = await mongoEventStore(() => models, { now: () => NOW }).aggregateDay(WINDOW, RUN)
		expect(result).toEqual({ completed: false, hits: 42, rows: 0 })
		const write = calls.find((call) => call.method === 'aggregates.bulkWrite')
		const [operations] = write?.args ?? []
		const [first] = Array.isArray(operations) ? operations : []
		const gen = first?.replaceOne?.replacement?.gen
		expect(calls.slice(-2)).toEqual([
			{
				method: 'aggregates.deleteMany',
				args: [expect.objectContaining({ gen: { $in: [gen] } })],
			},
			{ method: 'state.deleteOne', args: [{ _id: `drop:s:20261006:${gen}` }] },
		])
	})

	const groupsOf = (call: Call | undefined): number =>
		JSON.stringify(call?.args[0]).match(/"\$group"/g)?.length ?? 0

	it('folds a day in sets, and past the set fold size per visitor once a set outgrows its limit', async () => {
		const overLimit = Object.assign(new Error('$addToSet used too much memory'), {
			code: 146,
			codeName: 'ExceededMemoryLimit',
		})
		const read = (pipeline: object[]) =>
			JSON.stringify(pipeline).includes('"$addToSet":{"$cond":[{"$eq":["$facts.visitors"')
				? overLimit
				: [factRow(0, '', 3)]
		const small = fakes({ markers: () => [marker()], read })
		await expect(
			mongoEventStore(() => small.models, { now: () => NOW, setFoldHits: 100 }).aggregateDay(
				WINDOW,
				RUN
			)
		).rejects.toBe(overLimit)
		const big = fakes({ markers: () => [marker()], read })
		const result = await mongoEventStore(() => big.models, {
			now: () => NOW,
			setFoldHits: 10,
		}).aggregateDay(WINDOW, RUN)
		expect(result).toEqual({ completed: true, hits: 42, rows: 1 })
		const reads = big.calls.filter((call) => call.method === 'hits.aggregate').slice(-2)
		expect(reads.map(groupsOf)).toEqual([2, 3])
	})

	it('leaves any other failure of the set fold alone', async () => {
		const failure = Object.assign(new Error('interrupted'), { code: 11601 })
		const { models } = fakes({ markers: () => [marker()], read: () => failure })
		await expect(
			mongoEventStore(() => models, { now: () => NOW, setFoldHits: 10 }).aggregateDay(WINDOW, RUN)
		).rejects.toBe(failure)
	})

	it("looks every order's other record up inside the day's one read, whatever the orders", async () => {
		const { models, calls } = fakes({ markers: () => [marker()] })
		await mongoEventStore(() => models, { now: () => NOW, twinWindowMs: 3_600_000 }).aggregateDay(
			WINDOW,
			RUN
		)
		const reads = calls.filter((call) => call.method === 'hits.aggregate')
		expect(reads).toHaveLength(2)
		const pipeline = Array.isArray(reads[1]?.args[0]) ? reads[1].args[0] : []
		const window = { scope: 's', ts: { $gte: WINDOW.start, $lt: WINDOW.end } }
		expect(pipeline[0]).toEqual({ $match: { ...window, _id: { $not: { $gte: 'o', $lt: 'p' } } } })
		const union = pipeline[1]?.$unionWith
		expect(union?.coll).toBe('analytics-hits')
		expect(union?.pipeline.slice(0, 3)).toEqual([
			{ $match: { ...window, _id: { $gte: 'o', $lt: 'p' } } },
			{ $set: { tid: expect.any(Object) } },
			{
				$lookup: {
					from: 'analytics-hits',
					localField: 'tid',
					foreignField: '_id',
					pipeline: [
						{ $project: expect.objectContaining({ ts: 1, item: 1, revenue: 1, goals: 1 }) },
					],
					as: 'tw',
				},
			},
		])
		expect(JSON.stringify(pipeline)).toContain(
			'{"$lte":[{"$abs":{"$subtract":["$tw.ts","$ts"]}},3600000]}'
		)
		expect(JSON.stringify(pipeline)).not.toContain('$literal')
	})
})

describe('mongoEventStore.readAggregates', () => {
	it('reads the generation each day completed, checking the markers again after', async () => {
		const { models, calls } = fakes({
			markers: () => [{ scope: 's', day: 20261006, gen: 'G1' }],
		})
		const rows = await mongoEventStore(() => models).readAggregates({
			scope: 's',
			days: [[20261006, 20261006]],
			dim: 'page',
			groupBy: 'value',
		})
		expect(rows).toEqual([{ value: '/a', parts: expect.objectContaining({ pageviews: 5 }) }])
		expect(calls.map((call) => call.method)).toEqual([
			'state.find',
			'aggregates.aggregate',
			'state.find',
		])
		expect(JSON.stringify(calls[1]?.args[0])).toContain(
			'"day":{"$gte":20261006,"$lte":20261006},"gen":{"$in":["G1"]}'
		)
		expect(dayGenKey('s', 20261006)).toBe('["s",20261006]')
	})

	it('answers zeros for a total when no day it covers is complete, without reading rows', async () => {
		const { models, calls } = fakes({ markers: () => [] })
		const [total] = await mongoEventStore(() => models).readAggregates({
			scope: 's',
			days: [[20261006, 20261006]],
			dim: '',
			groupBy: 'total',
		})
		expect(total?.parts).toMatchObject({ pageviews: 0, impressions: null })
		expect(calls.map((call) => call.method)).toEqual(['state.find', 'state.find'])
	})
})
