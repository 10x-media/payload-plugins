import { describe, expect, it, vi } from 'vitest'
import { SourceMisconfiguredError } from '../../../core/sourceErrors'
import { dayWindow } from '../aggregate'
import { DEFAULT_CAPS } from '../caps'
import { ReadTimeoutError } from '../rawRead'
import type { HitRow } from '../types'
import {
	isMongoHitsModel,
	LANDING_TIMEOUT_MS,
	type MongoHitsModel,
	type MongoStoreOptions,
	mongoEventStore,
	mongoVersionRefusal,
	refusesDiskUse,
} from './mongoStore'

const TS = new Date('2026-10-06T10:00:00.000Z')

const hit = (id: string, overrides: Partial<HitRow> = {}): HitRow => ({
	id,
	scope: '',
	ts: TS,
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'AAAAAAAAAAAAAAAA',
	landing: true,
	server: false,
	...overrides,
})

/** The driver's per-document error: its code sits behind a getter, as on `WriteError`. */
class FakeWriteError {
	readonly err: { code: number; index: number }
	constructor(code: number, index: number) {
		this.err = { code, index }
	}
	get code(): number {
		return this.err.code
	}
}

const bulkError = (codes: number[]): Error =>
	Object.assign(new Error('bulk write failed'), {
		writeErrors: codes.map((code, index) => new FakeWriteError(code, index)),
	})

interface Reads {
	/** What each aggregation answers, or the error it fails with. */
	aggregate?: () => unknown[] | Error
	findOne?: unknown
	distinct?: unknown[]
}

/** A model whose collection records each insert and read, answering inserts with `answer`. */
const fakeModel = (
	answer: (docs: object[]) => Error | undefined = () => undefined,
	reads: Reads = {}
) => {
	const inserts: Array<{ docs: Array<Record<string, unknown>>; options: object }> = []
	const aggregations: Array<{ pipeline: object[]; options: object }> = []
	const finds: Array<{ filter: object; options: object }> = []
	const deletes: object[] = []
	const updates: Array<{ filter: object; update: object }> = []
	const model: MongoHitsModel = {
		collection: {
			collectionName: 'analytics-hits',
			insertMany: async (docs, options) => {
				inserts.push({ docs: docs.map((doc) => ({ ...doc })), options })
				const error = answer(docs)
				if (error) {
					throw error
				}
				return { insertedCount: docs.length }
			},
			aggregate: (pipeline, options) => {
				aggregations.push({ pipeline, options })
				return {
					toArray: async () => {
						const docs = reads.aggregate?.() ?? []
						if (docs instanceof Error) {
							throw docs
						}
						return docs
					},
				}
			},
			findOne: async (filter, options) => {
				finds.push({ filter, options })
				return reads.findOne ?? null
			},
			distinct: async () => reads.distinct ?? [],
			deleteMany: async (filter) => {
				deletes.push(filter)
				return { deletedCount: 2 }
			},
			updateMany: async (filter, update) => {
				updates.push({ filter, update })
				return { modifiedCount: 3 }
			},
		},
	}
	return { model, inserts, aggregations, finds, deletes, updates }
}

const unused = (): never => {
	throw new Error('a hit test never reaches the aggregates or the state rows')
}

/** A store over the fake hits; these tests never touch its aggregates or state rows. */
const storeOf = (model: MongoHitsModel, options: MongoStoreOptions = {}) =>
	mongoEventStore(
		() => ({
			hits: model,
			aggregates: {
				collection: { bulkWrite: unused, deleteMany: unused, distinct: unused, aggregate: unused },
			},
			state: {
				findOneAndUpdate: unused,
				updateMany: unused,
				find: unused,
				findOne: unused,
				deleteMany: unused,
				deleteOne: unused,
				bulkWrite: unused,
				distinct: unused,
			},
		}),
		options
	)

describe('mongoEventStore.append', () => {
	it('inserts each hit as a document keyed by its id, leaving out what it does not carry', async () => {
		const { model, inserts } = fakeModel()
		const result = await storeOf(model).append([
			hit('01A', { lastAt: undefined, props: { plan: 'pro' } }),
		])
		expect(result).toEqual({ written: 1, duplicates: 0 })
		expect(inserts).toEqual([
			{
				docs: [
					{
						_id: '01A',
						scope: '',
						ts: TS,
						type: 'pageview',
						hostname: 'a.example',
						path: '/',
						v: 'AAAAAAAAAAAAAAAA',
						landing: true,
						server: false,
						props: { plan: 'pro' },
					},
				],
				options: { ordered: false },
			},
		])
		expect(inserts[0]?.docs[0]?.ts).toBeInstanceOf(Date)
		expect(inserts[0]?.docs[0]).not.toHaveProperty('id')
		expect(inserts[0]?.docs[0]).not.toHaveProperty('lastAt')
	})

	it('inserts past 500 hits in chunks of 500, each unordered', async () => {
		const { model, inserts } = fakeModel()
		const hits = Array.from({ length: 1234 }, (_, i) => hit(`H${i}`))
		expect(await storeOf(model).append(hits)).toEqual({ written: 1234, duplicates: 0 })
		expect(inserts.map((insert) => insert.docs.length)).toEqual([500, 500, 234])
	})

	it('counts the documents an existing `_id` refused as duplicates, and keeps the rest written', async () => {
		const { model } = fakeModel(() => bulkError([11000, 11000]))
		expect(await storeOf(model).append([hit('A'), hit('B'), hit('C')])).toEqual({
			written: 1,
			duplicates: 2,
		})
	})

	it('inserts an id repeated within one call once, and counts the repeat as a duplicate', async () => {
		const { model, inserts } = fakeModel()
		const result = await storeOf(model).append([hit('A'), hit('A', { path: '/again' })])
		expect(result).toEqual({ written: 1, duplicates: 1 })
		expect(inserts[0]?.docs.map((doc) => doc.path)).toEqual(['/'])
	})

	it('throws anything else, and a batch that failed for anything but duplicates', async () => {
		const down = new Error('connection closed')
		await expect(storeOf(fakeModel(() => down).model).append([hit('A')])).rejects.toBe(down)
		const mixed = bulkError([11000, 121])
		await expect(storeOf(fakeModel(() => mixed).model).append([hit('A'), hit('B')])).rejects.toBe(
			mixed
		)
		const empty = bulkError([])
		await expect(storeOf(fakeModel(() => empty).model).append([hit('A')])).rejects.toBe(empty)
	})

	it('inserts nothing for no hits', async () => {
		const { model, inserts } = fakeModel()
		expect(await storeOf(model).append([])).toEqual({ written: 0, duplicates: 0 })
		expect(inserts).toEqual([])
	})
})

const START = new Date('2026-10-06T00:00:00.000Z')
const END = new Date('2026-10-07T00:00:00.000Z')

describe('mongoEventStore reads', () => {
	it('aggregates with disk use allowed and the read time as maxTimeMS, rows out of the groups', async () => {
		const { model, aggregations } = fakeModel(undefined, {
			aggregate: () => [
				{ _id: { g: '/a' }, pageviews: 3, events: 1, visitors: 2 },
				{ _id: { g: '/b' }, pageviews: 1, events: 0, visitors: 1 },
			],
		})
		const rows = await storeOf(model).readRaw({
			scope: 's',
			start: START,
			end: END,
			filters: [],
			groupBy: 'page',
			sessions: false,
			timeoutMs: 2500,
		})
		const [options] = aggregations.map((each) => each.options)
		expect(options).toEqual({ allowDiskUse: true, maxTimeMS: expect.any(Number) })
		expect(Reflect.get(options ?? {}, 'maxTimeMS')).toBeGreaterThan(2400)
		expect(Reflect.get(options ?? {}, 'maxTimeMS')).toBeLessThanOrEqual(2500)
		expect(aggregations[0]?.pipeline[0]).toEqual({
			$match: { scope: 's', ts: { $gte: START, $lt: END }, _id: { $not: { $gte: 'o', $lt: 'p' } } },
		})
		expect(rows.map((row) => [row.value, row.parts.pageviews, row.parts.visitors])).toEqual([
			['/a', 3, 2],
			['/b', 1, 1],
		])
		expect(rows[0]?.parts.sessions).toBeNull()
	})

	it('spends one deadline across a read’s pipelines, each given what is left of it', async () => {
		let at = 1_000
		const clock = vi.spyOn(performance, 'now').mockImplementation(() => at)
		try {
			const read = {
				scope: 's',
				start: START,
				end: END,
				filters: [{ dimension: 'country' as const, operator: 'eq' as const, value: 'DE' }],
				groupBy: 'page' as const,
				sessions: true,
				timeoutMs: 2500,
			}
			const slow = fakeModel(undefined, {
				aggregate: () => {
					at += 2_000
					return [{ _id: { h: 'a.example', v: 'v1' } }]
				},
			})
			await storeOf(slow.model).readRaw(read)
			expect(slow.aggregations.map((each) => Reflect.get(each.options, 'maxTimeMS'))).toEqual([
				2500, 500,
			])
			at = 1_000
			const slower = fakeModel(undefined, {
				aggregate: () => {
					at += 2_600
					return [{ _id: { h: 'a.example', v: 'v1' } }]
				},
			})
			await expect(storeOf(slower.model).readRaw(read)).rejects.toBeInstanceOf(ReadTimeoutError)
			expect(slower.aggregations).toHaveLength(1)
		} finally {
			clock.mockRestore()
		}
	})

	it('reads one hit by its id alone, its document as a hit', async () => {
		const doc = {
			_id: 'os.abc',
			scope: 's',
			ts: TS,
			type: 'goal',
			hostname: 'h',
			path: '/orders',
			v: '',
			landing: false,
			server: true,
			goals: [{ slug: 'purchase', value: 250, sent: 260 }],
			revenue: 250,
		}
		const { model, finds } = fakeModel(undefined, { findOne: doc })
		expect(await storeOf(model).hitById('os.abc')).toEqual({
			id: 'os.abc',
			scope: 's',
			ts: TS,
			type: 'goal',
			hostname: 'h',
			path: '/orders',
			v: '',
			landing: false,
			server: true,
			goals: [{ slug: 'purchase', value: 250, sent: 260 }],
			revenue: 250,
		})
		expect(finds).toEqual([{ filter: { _id: 'os.abc' }, options: {} }])
		const { model: empty } = fakeModel()
		expect(await storeOf(empty).hitById('os.none')).toBeNull()
	})

	it('answers one row of zeros for a total nothing matched', async () => {
		const { model } = fakeModel(undefined, { aggregate: () => [] })
		const [row] = await storeOf(model).readRaw({
			start: START,
			end: END,
			filters: [],
			sessions: true,
			timeoutMs: 1000,
		})
		expect(row?.value).toBeNull()
		expect(row?.parts.pageviews).toBe(0)
		expect(row?.parts.sessions).toBe(0)
		expect(row?.parts.impressions).toBeNull()
	})

	it("turns MongoDB's maxTimeMS error into a ReadTimeoutError and rethrows anything else", async () => {
		const expired = Object.assign(new Error('time limit'), { code: 50 })
		const timed = fakeModel(undefined, { aggregate: () => expired })
		const read = { start: START, end: END, filters: [], sessions: false, timeoutMs: 10 }
		await expect(storeOf(timed.model).readRaw(read)).rejects.toBeInstanceOf(ReadTimeoutError)
		const down = new Error('connection closed')
		const failing = fakeModel(undefined, { aggregate: () => down })
		await expect(storeOf(failing.model).readRaw(read)).rejects.toBe(down)
	})

	it('looks for one hit of the window through the (scope, ts) index', async () => {
		const { model, finds } = fakeModel(undefined, { findOne: { _id: 'x' } })
		expect(await storeOf(model).hasHits({ scope: '', start: START, end: END })).toBe(true)
		expect(finds).toEqual([
			{ filter: { scope: '', ts: { $gte: START, $lt: END } }, options: { projection: { _id: 1 } } },
		])
		expect(await storeOf(fakeModel().model).hasHits({ scope: '', start: START, end: END })).toBe(
			false
		)
	})

	it('lists the distinct scopes in code point order', async () => {
		const { model } = fakeModel(undefined, { distinct: ['b', '', 'B', 'a', 7] })
		expect(await storeOf(model).scopes()).toEqual(['', 'B', 'a', 'b'])
	})
})

describe('a MongoDB server the engine meets', () => {
	const read = { start: START, end: END, filters: [], sessions: false, timeoutMs: 1000 }

	it('refuses a server before 5.0, whose aggregations have no $setWindowFields', () => {
		expect(mongoVersionRefusal('4.4.18')).toMatch(/needs MongoDB 5.0 or later.*runs 4.4.18/)
		expect(mongoVersionRefusal('5.0.0')).toBeNull()
		expect(mongoVersionRefusal('7.0.24')).toBeNull()
		expect(mongoVersionRefusal(null)).toBeNull()
		expect(mongoVersionRefusal('unknown')).toBeNull()
	})

	it('says so once at its start, refuses its counts and visit reads, and keeps storing hits', async () => {
		const warn = vi.fn()
		const { model, inserts } = fakeModel()
		const store = storeOf(model, { serverVersion: async () => '4.4.18', warn })
		await expect(store.readRaw(read)).rejects.toBeInstanceOf(SourceMisconfiguredError)
		await expect(
			store.aggregateDay(dayWindow('', 20261006, 'UTC'), {
				runId: 'run-1',
				caps: DEFAULT_CAPS,
				status: 'final',
			})
		).rejects.toThrow(/needs MongoDB 5.0/)
		await store.append([hit('a')])
		expect(inserts).toHaveLength(1)
		expect(warn).toHaveBeenCalledTimes(1)
		const fine = storeOf(fakeModel().model, {
			serverVersion: () => Promise.reject(new Error('no buildInfo here')),
			warn,
		})
		await expect(fine.readRaw(read)).resolves.toHaveLength(1)
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('runs its aggregations without allowDiskUse from the first time a server refuses it', async () => {
		const atlas = Object.assign(new Error('allowDiskUse is not allowed in this atlas tier'), {
			code: 8000,
			codeName: 'AtlasError',
		})
		const aggregations: object[] = []
		const model: MongoHitsModel = {
			collection: {
				...fakeModel().model.collection,
				aggregate: (_pipeline, options) => {
					aggregations.push(options)
					return {
						toArray: async () => {
							if (Reflect.get(options, 'allowDiskUse') === true) {
								throw atlas
							}
							return []
						},
					}
				},
			},
		}
		const store = storeOf(model)
		await store.readRaw(read)
		await store.countHits({ scope: '', start: START, end: END }, 10)
		expect(aggregations.map((options) => Reflect.get(options, 'allowDiskUse'))).toEqual([
			true,
			undefined,
			undefined,
		])
		expect(Reflect.get(aggregations[1] ?? {}, 'maxTimeMS')).toBeGreaterThan(0)
		expect(refusesDiskUse(atlas)).toBe(true)
		expect(refusesDiskUse(new Error('connection closed'))).toBe(false)
	})

	it("looks for a sale's landing within its own time, and lets the sale keep its own past it", async () => {
		const probe = { scope: 's', hostname: 'h', v: 'v', start: START, end: END }
		const timed = fakeModel(undefined, { aggregate: () => [{ _id: 'L', ts: TS, scope: 's' }] })
		await storeOf(timed.model).latestLanding(probe)
		expect(timed.aggregations[0]?.options).toEqual({ maxTimeMS: LANDING_TIMEOUT_MS })
		const expired = Object.assign(new Error('operation exceeded time limit'), { code: 50 })
		const slow = fakeModel(undefined, { aggregate: () => expired })
		expect(await storeOf(slow.model).latestLanding(probe)).toBeNull()
		const down = new Error('connection closed')
		const failing = fakeModel(undefined, { aggregate: () => down })
		await expect(storeOf(failing.model).latestLanding(probe)).rejects.toBe(down)
	})
})

describe('mongoEventStore upkeep', () => {
	it('finds a scope’s oldest hit off its (scope, ts) index', async () => {
		const ts = new Date('2026-10-01T08:00:00.000Z')
		const { model, finds } = fakeModel(undefined, { findOne: { _id: 'x', ts } })
		expect(await storeOf(model).oldestHit('s')).toEqual(ts)
		expect(finds).toEqual([
			{ filter: { scope: 's' }, options: { sort: { ts: 1 }, projection: { ts: 1 } } },
		])
		expect(await storeOf(fakeModel().model).oldestHit('s')).toBeNull()
	})

	it('prunes a bounded chunk of a scope’s hits by id, and nothing when none is that old', async () => {
		const before = new Date('2026-07-01T00:00:00.000Z')
		const { model, aggregations, deletes, updates } = fakeModel(undefined, {
			aggregate: () => [{ _id: 'a' }, { _id: 'b' }],
		})
		expect(await storeOf(model).pruneHits({ scope: 's', before, limit: 2 })).toBe(2)
		expect(aggregations[0]?.pipeline).toEqual([
			{
				$match: { scope: 's', ts: { $lt: before }, _id: { $not: { $gte: 'o', $lt: 'p' } } },
			},
			{ $limit: 2 },
			{ $project: { _id: 1 } },
		])
		expect(deletes).toEqual([{ _id: { $in: ['a', 'b'] } }])
		expect(updates).toEqual([])
		const empty = fakeModel()
		expect(await storeOf(empty.model).pruneHits({ scope: 's', before, limit: 2 })).toBe(0)
		expect(empty.deletes).toEqual([])
		await expect(storeOf(model).pruneHits({ scope: 's', before, limit: 0 })).rejects.toThrow(
			/whole size/
		)
	})

	it("keeps an order's record as its tombstone, from where the last prune stopped", async () => {
		const from = new Date('2026-06-30T00:00:00.000Z')
		const before = new Date('2026-07-01T00:00:00.000Z')
		const answers = [[{ _id: 'a' }], [{ _id: 'ow.x' }, { _id: 'os.x' }]]
		const { model, aggregations, deletes, updates } = fakeModel(undefined, {
			aggregate: () => answers.shift() ?? [],
		})
		expect(await storeOf(model).pruneHits({ scope: 's', from, before, limit: 10 })).toBe(5)
		const ts = { $gte: from, $lt: before }
		expect(aggregations.map((each) => each.pipeline[0])).toEqual([
			{ $match: { scope: 's', ts, _id: { $not: { $gte: 'o', $lt: 'p' } } } },
			{
				$match: {
					scope: 's',
					ts,
					_id: { $gte: 'o', $lt: 'p' },
					$or: expect.arrayContaining([
						{ v: { $ne: '' } },
						{ country: { $exists: true } },
						{ props: { $exists: true } },
					]),
				},
			},
		])
		expect(aggregations[1]?.pipeline[1]).toEqual({ $limit: 9 })
		expect(deletes).toEqual([{ _id: { $in: ['a'] } }])
		expect(updates).toEqual([
			{
				filter: { _id: { $in: ['ow.x', 'os.x'] } },
				update: {
					$set: { v: '' },
					$unset: expect.objectContaining({ utmCampaign: '', city: '', props: '', lastAt: '' }),
				},
			},
		])
	})

	it('deletes order records past their days’ totals', async () => {
		const before = new Date('2026-01-01T00:00:00.000Z')
		const { model, aggregations, deletes } = fakeModel(undefined, {
			aggregate: () => [{ _id: 'os.old' }],
		})
		expect(await storeOf(model).expireOrders({ scope: 's', before, limit: 5 })).toBe(2)
		expect(aggregations[0]?.pipeline[0]).toEqual({
			$match: { scope: 's', ts: { $lt: before }, _id: { $gte: 'o', $lt: 'p' } },
		})
		expect(deletes).toEqual([{ _id: { $in: ['os.old'] } }])
	})

	it('reclassifies each distinct tuple a day and a chunk at a time, null matching absent', async () => {
		const start = new Date('2026-10-05T00:00:00.000Z')
		const end = new Date('2026-10-06T12:00:00.000Z')
		const { model, aggregations, updates } = fakeModel(undefined, {
			aggregate: () => [
				{ _id: { ref: 'google.com' } },
				{ _id: { utmSource: 'news', utmMedium: 'email' } },
				{ _id: { ref: 'google.com' } },
			],
		})
		const changed = await storeOf(model).reclassify({
			scope: 's',
			start,
			end,
			version: 2,
			classify: (tuple) => (tuple.ref ? 'organic-search' : 'email'),
		})
		expect(aggregations[0]?.pipeline).toEqual([
			{ $match: { scope: 's', ts: { $gte: start, $lt: end }, channelVersion: { $lt: 2 } } },
			{
				$group: {
					_id: {
						ref: '$ref',
						utmSource: '$utmSource',
						utmMedium: '$utmMedium',
						clickId: '$clickId',
					},
				},
			},
		])
		// Two slices (a whole day, then half of one) times two channels.
		expect(updates).toHaveLength(4)
		expect(updates[0]).toEqual({
			filter: {
				scope: 's',
				ts: { $gte: start, $lt: new Date('2026-10-06T00:00:00.000Z') },
				channelVersion: { $lt: 2 },
				$or: [{ ref: 'google.com', utmSource: null, utmMedium: null, clickId: null }],
			},
			update: { $set: { channel: 'organic-search', channelVersion: 2 } },
		})
		expect(changed).toBe(12)
	})
})

describe('isMongoHitsModel', () => {
	it('takes a model, a function as mongoose makes them, whose named collection inserts and reads', () => {
		const collection = {
			collectionName: 'analytics-hits',
			insertMany: () => undefined,
			aggregate: () => undefined,
			findOne: () => undefined,
			distinct: () => undefined,
			deleteMany: () => undefined,
			updateMany: () => undefined,
		}
		expect(isMongoHitsModel(Object.assign(() => undefined, { collection }))).toBe(true)
		const { collectionName: _name, ...unnamed } = collection
		expect(isMongoHitsModel({ collection: unnamed })).toBe(false)
		expect(isMongoHitsModel({ collection: { insertMany: () => undefined } })).toBe(false)
		expect(isMongoHitsModel({ collection: {} })).toBe(false)
		expect(isMongoHitsModel(undefined)).toBe(false)
	})
})
