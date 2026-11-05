import { currentDate } from '../../../core/clock'
import { monotonicMs } from '../../../core/monotonic'
import { SourceMisconfiguredError } from '../../../core/sourceErrors'
import { hasMethods, isRecord } from '../../../core/values'
import { isMongoOverLimit, isStatementTimeout, isUniqueViolation } from '../../../db/errors'
import {
	type AggregatePlan,
	type AggregateRecord,
	capDay,
	checkDayWindow,
	checkRun,
	type DayRow,
	dayGenKey,
	dayRowOf,
	emptyAggregateRow,
	foldedDaysOf,
	type GenerationWriter,
	heldMarker,
	mergeAggregateRows,
	partsOfSums,
	planAggregateRead,
	planFoldRead,
	readStable,
	refusedRun,
	writeBeside,
} from '../aggregate'
import { checkLimit, chunksOf } from '../chunks'
import { dateOf, numberOf, textOf } from '../columnValues'
import { hitRowOf } from '../hitRow'
import { distinctHits, HIT_CHUNK, TOMBSTONE_CLEARED, TWIN_WINDOW_MS } from '../hits'
import { generationRowId } from '../ids'
import { patternFault } from '../pattern'
import {
	checkCountBound,
	compareCodePoints,
	emptyRow,
	fillsNothing,
	partsFrom,
	planRawRead,
	type RawPlan,
	ReadTimeoutError,
	rawFilterMap,
	readRealtime,
} from '../rawRead'
import { channelGroups, channelTupleOf, RECLASSIFY_TUPLES, windowSlices } from '../reclassify'
import type {
	AggregateHooks,
	AggregateRead,
	AggregateRow,
	EventStore,
	HitRow,
	RawRead,
	RawRow,
} from '../types'
import {
	aggregateReadPipeline,
	dayAggregationPipeline,
	dayHitsPipeline,
	dayRowsFilter,
	daysMatch,
	foldReadPipeline,
	SET_FOLD_HITS,
} from './aggregatePipelines'
import { type MongoStateModel, mongoStateStore } from './mongoState'
import {
	type KeptVisitors,
	keptVisitorsPipeline,
	ORDER_RANGE,
	rawReadPipeline,
	type Stage,
	scopeMatch,
	type TwinLookup,
	windowMatch,
} from './pipelines'
import { deletedOf, distinctStrings, foundDocuments, modifiedOf } from './results'

/**
 * The hits model's driver collection: the model's own `insertMany` would cast every hit and drop
 * the error codes duplicates are counted by. `aggregate` answers a cursor, or a promise of one.
 */
export interface MongoHitsModel {
	collection: {
		/** The collection's name, which a `$lookup` of an order's other record reads from. */
		readonly collectionName: string
		insertMany(docs: object[], options: object): PromiseLike<unknown>
		aggregate(pipeline: object[], options: object): unknown
		findOne(filter: object, options: object): PromiseLike<unknown>
		distinct(key: string, filter: object): PromiseLike<unknown>
		deleteMany(filter: object): PromiseLike<unknown>
		updateMany(filter: object, update: object): PromiseLike<unknown>
	}
}

/** A model's driver `collection`: a mongoose model is a function, which `isRecord` refuses. */
const collectionOf = (model: unknown): unknown =>
	(typeof model === 'object' || typeof model === 'function') && model !== null
		? Reflect.get(model, 'collection')
		: undefined

export const isMongoHitsModel = (value: unknown): value is MongoHitsModel => {
	const collection = collectionOf(value)
	return (
		isRecord(collection) &&
		typeof collection.collectionName === 'string' &&
		hasMethods(collection, [
			'insertMany',
			'aggregate',
			'findOne',
			'distinct',
			'deleteMany',
			'updateMany',
		])
	)
}

/**
 * The slice of the aggregates model the store calls, its driver collection: rows are written and
 * swept as given, and read through aggregations.
 */
export interface MongoAggregatesModel {
	collection: {
		bulkWrite(operations: object[], options: object): PromiseLike<unknown>
		deleteMany(filter: object): PromiseLike<unknown>
		distinct(key: string, filter: object): PromiseLike<unknown>
		aggregate(pipeline: object[], options: object): unknown
	}
}

export const isMongoAggregatesModel = (value: unknown): value is MongoAggregatesModel =>
	hasMethods(collectionOf(value), ['bulkWrite', 'deleteMany', 'distinct', 'aggregate'])

export interface MongoStoreModels {
	hits: MongoHitsModel
	aggregates: MongoAggregatesModel
	state: MongoStateModel
}

export interface MongoStoreOptions {
	/** Clock leases are stamped and runs dated with; plugin's clock (`currentDate`) by default. */
	now?: () => Date
	hooks?: AggregateHooks
	/** Most hits a day may hold to always fold in sets (`SET_FOLD_HITS`); tests lower it. */
	setFoldHits?: number
	/** Folds every day per visitor, never in sets: tests hold both folds to one answer. */
	perVisitor?: boolean
	/** How far apart an order's records may lie to count as one sale; `TWIN_WINDOW_MS` by default. */
	twinWindowMs?: number | null
	/** The server's version (`buildInfo`), null when unknown; asked once, at the store's start. */
	serverVersion?: () => Promise<string | null>
	/** Told once, at the start, when the server is too old for the engine's counts. */
	warn?: (message: string) => void
}

/** The oldest MongoDB whose `$setWindowFields` the engine's counts and visit reads are built on. */
const MIN_MONGO_MAJOR = 5

/** Why a server cannot run the engine's counts and visit reads; null when it can or is unknown. */
export const mongoVersionRefusal = (version: string | null): string | null => {
	const major = version === null ? Number.NaN : Number(version.split('.')[0])
	if (!Number.isInteger(major) || major >= MIN_MONGO_MAJOR) {
		return null
	}
	return `analytics: the native engine needs MongoDB ${MIN_MONGO_MAJOR}.0 or later, whose $setWindowFields cuts visits, and this server runs ${version}. Hits are still stored; upgrade the server to count and read them, or read through a vendor adapter meanwhile.`
}

/** What a tombstone clears, as one `$unset`. */
const TOMBSTONE_UNSET: Record<string, ''> = Object.fromEntries(
	TOMBSTONE_CLEARED.map((field) => [field, ''])
)

/** An order's record still holding anything a tombstone clears. */
const HOLDS_VISIT: Array<Record<string, unknown>> = [
	{ v: { $ne: '' } },
	...TOMBSTONE_CLEARED.map((field) => ({ [field]: { $exists: true } })),
]

/** A stored document as a hit, its `_id` as the id; null for anything else. */
const hitOf = (doc: unknown): HitRow | null =>
	isRecord(doc) ? hitRowOf((field) => (field === 'id' ? doc._id : doc[field])) : null

interface Cursor {
	toArray(): Promise<unknown>
}

const isCursor = (value: unknown): value is Cursor => hasMethods(value, ['toArray'])

/** What an aggregation is run with: disk use for its big stages, and its time where it has one. */
interface AggregateOptions {
	allowDiskUse?: boolean
	maxTimeMS?: number
}

type Aggregating = { aggregate(pipeline: object[], options: object): unknown }

type Deleting = { deleteMany(filter: object): PromiseLike<unknown> }

const DISK_USE: AggregateOptions = { allowDiskUse: true }

/**
 * Options for each pipeline of one job sharing a deadline `timeoutMs` from now: each runs with what
 * is left of it, and none starts once it passed. Without a timeout, disk use alone.
 */
const deadlineOptions = (timeoutMs: number | undefined): (() => AggregateOptions) => {
	if (timeoutMs === undefined) {
		return () => DISK_USE
	}
	const deadline = monotonicMs() + timeoutMs
	return () => {
		const left = Math.floor(deadline - monotonicMs())
		if (left < 1) {
			throw new ReadTimeoutError('mongo', timeoutMs)
		}
		return { ...DISK_USE, maxTimeMS: left }
	}
}

/** Scopes one `countEach` command counts, each in a `$unionWith` sub-pipeline of its own. */
const COUNT_CHUNK = 100

/** How long to look for a sale's latest landing, past which the sale keeps its own attribution. */
export const LANDING_TIMEOUT_MS = 5_000

/** Every document an aggregation answers, awaiting the cursor mongoose may still be opening. */
const cursorDocuments = async (
	collection: Aggregating,
	pipeline: Stage[],
	options: AggregateOptions
): Promise<unknown[]> => {
	const cursor: unknown = await collection.aggregate(pipeline, options)
	if (!isCursor(cursor)) {
		throw new Error('analytics: a collection answered an aggregation with no cursor')
	}
	const docs: unknown = await cursor.toArray()
	return Array.isArray(docs) ? docs : []
}

/** Atlas' shared and flex tiers refuse `allowDiskUse` outright, where any other server takes it. */
export const refusesDiskUse = (err: unknown): boolean => {
	const message = isRecord(err) ? err.message : undefined
	return typeof message === 'string' && /allowDiskUse/i.test(message)
}

/**
 * `cursorDocuments`, run without `allowDiskUse` from the first refusal of it on: a big stage there
 * then has the server's memory alone, as such a tier gives every query.
 */
const diskUseFallback = () => {
	let refused = false
	const without = ({ allowDiskUse: _ignored, ...rest }: AggregateOptions): AggregateOptions => rest
	return async (
		collection: Aggregating,
		pipeline: Stage[],
		options: AggregateOptions
	): Promise<unknown[]> => {
		if (refused || !options.allowDiskUse) {
			return cursorDocuments(collection, pipeline, without(options))
		}
		try {
			return await cursorDocuments(collection, pipeline, options)
		} catch (err) {
			if (!refusesDiskUse(err)) {
				throw err
			}
			refused = true
			return cursorDocuments(collection, pipeline, without(options))
		}
	}
}

/** The `n` of a `$count` stage's document, 0 when it answered none, as it does for no match. */
const countIn = (doc: unknown): number => (isRecord(doc) ? numberOf(doc.n) : null) ?? 0

/** Deletes the documents of `ids`, answering how many went; no command for no ids. */
const deleteIds = async (collection: Deleting, ids: readonly unknown[]): Promise<number> =>
	ids.length === 0 ? 0 : deletedOf(await collection.deleteMany({ _id: { $in: ids } }))

/** An aggregate row as its document: one per key and generation, so a rewrite never overwrites. */
const aggregateDocumentOf = (record: AggregateRecord): Record<string, unknown> => ({
	_id: generationRowId(record),
	scope: record.scope,
	day: record.day,
	hostname: record.hostname,
	dim: record.dim,
	value: record.value,
	dim2: record.dim2,
	value2: record.value2,
	gen: record.gen,
	...record.parts,
})

/** A day's read answered: its rows, capped by the pipeline, its `(other)` rows marked folded. */
const dayRowsOf = (docs: readonly unknown[]): DayRow[] =>
	docs.filter(isRecord).flatMap((doc) => {
		const key = isRecord(doc._id) ? doc._id : {}
		const kind = numberOf(key.k)
		const row =
			kind === null
				? undefined
				: dayRowOf(
						{
							kind,
							hostname: textOf(key.h) ?? '',
							value: textOf(key.a) ?? '',
							value2: textOf(key.b) ?? '',
							folded: numberOf(key.o) === 1,
						},
						(part) => numberOf(doc[part])
					)
		return row ? [row] : []
	})

/** The rows an aggregate read's documents hold, none filled in where it matched nothing. */
const rowsOfDocs = (docs: readonly unknown[], plan: AggregatePlan): AggregateRow[] =>
	docs.filter(isRecord).map((doc): AggregateRow => {
		const parts = partsOfSums((part) => numberOf(doc[part]))
		if (plan.group === 'day') {
			return { value: null, day: numberOf(doc._id) ?? 0, parts }
		}
		return { value: plan.group === null ? null : textOf(doc._id), parts }
	})

/** {@link rowsOfDocs}, a total answering its one row even where it matched nothing. */
const aggregateRowsOf = (docs: readonly unknown[], plan: AggregatePlan): AggregateRow[] => {
	const rows = rowsOfDocs(docs, plan)
	return plan.group === null ? [rows[0] ?? emptyAggregateRow(plan)] : rows
}

/**
 * Generations one pipeline matches at most: a read over more (every site, many days) runs one
 * pipeline per share of them, whose rows add up, rather than one command too big to send.
 */
const GENS_PER_PIPELINE = 10_000

/** The generation each completed day of a read holds, read off the day markers. */
const generationsOf = async (
	state: MongoStateModel,
	read: Pick<AggregateRead, 'scope' | 'scopes' | 'days'>
): Promise<Map<string, string>> => {
	const docs = await state.find(
		{
			kind: 'day',
			...scopeMatch(read),
			...daysMatch(read.days),
			gen: { $type: 'string' },
		},
		{ scope: 1, day: 1, gen: 1 },
		{ lean: true }
	)
	const gens = new Map<string, string>()
	for (const doc of foundDocuments(docs)) {
		const day = numberOf(doc.day)
		if (typeof doc.scope === 'string' && typeof doc.gen === 'string' && day !== null) {
			gens.set(dayGenKey(doc.scope, day), doc.gen)
		}
	}
	return gens
}

/** A hit as its document: the id as `_id`, and an absent field left out rather than stored null. */
const hitDocumentOf = (hit: HitRow): Record<string, unknown> => {
	const { id, ...fields } = hit
	const doc: Record<string, unknown> = { _id: id }
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) {
			doc[key] = value
		}
	}
	return doc
}

/**
 * How many documents an unordered insert lost to an `_id` already stored, or null when it lost
 * any to something else, or failed as a whole.
 */
const duplicatesOf = (error: unknown): number | null => {
	const writeErrors = isRecord(error) ? error.writeErrors : undefined
	if (!Array.isArray(writeErrors) || writeErrors.length === 0) {
		return null
	}
	return writeErrors.every((entry) => isUniqueViolation(entry)) ? writeErrors.length : null
}

/**
 * The most visitors one condition may keep for a read to name them: past it the condition keeps
 * too many for the narrower read to pay for its list, and the read keeps everyone instead.
 */
const KEPT_VISITORS_LIMIT = 100_000

/** One visitor a condition keeps. */
interface Visitor {
	scope: string
	hostname: string
	v: string
}

/** Visitors a read keeps, grouped by scope and hostname, the scope left out on a scoped read. */
const groupKept = (visitors: Iterable<Visitor>, scoped: boolean): KeptVisitors[] => {
	const groups = new Map<string, { scope?: string; hostname: string; ids: string[] }>()
	for (const visitor of visitors) {
		const key = JSON.stringify([scoped ? '' : visitor.scope, visitor.hostname])
		const group = groups.get(key) ?? {
			...(scoped ? {} : { scope: visitor.scope }),
			hostname: visitor.hostname,
			ids: [],
		}
		group.ids.push(visitor.v)
		groups.set(key, group)
	}
	return [...groups.values()]
}

/** The visitors a `keptVisitorsPipeline` answered, by their key. */
const visitorsOf = (docs: readonly unknown[]): Map<string, Visitor> => {
	const visitors = new Map<string, Visitor>()
	for (const doc of docs) {
		const key = isRecord(doc) && isRecord(doc._id) ? doc._id : undefined
		if (key && typeof key.h === 'string' && typeof key.v === 'string') {
			const visitor = { scope: typeof key.s === 'string' ? key.s : '', hostname: key.h, v: key.v }
			visitors.set(JSON.stringify([visitor.scope, visitor.hostname, visitor.v]), visitor)
		}
	}
	return visitors
}

/** The rows a raw read's documents hold; a total answers its one row even where nothing matched. */
const rowsOf = (docs: readonly unknown[], plan: RawPlan): RawRow[] => {
	const rows = docs.filter(isRecord).map((doc): RawRow => {
		const key = isRecord(doc._id) ? doc._id : {}
		return {
			value: plan.group === undefined ? null : textOf(key.g),
			...(plan.read.buckets === undefined ? {} : { bucket: numberOf(key.b) ?? 0 }),
			parts: partsFrom(plan.counted, (part) => numberOf(doc[part])),
		}
	})
	if (plan.group === undefined && plan.read.buckets === undefined) {
		return [rows[0] ?? emptyRow(plan)]
	}
	return rows
}

/**
 * The hit store on MongoDB. A chunk is one unordered insert, so a duplicate `_id` costs that one
 * document; no session is passed, so no write joins and no read waits on a host transaction.
 */
export const mongoEventStore = (
	models: () => MongoStoreModels,
	options: MongoStoreOptions = {}
): EventStore => {
	// Looked up per call: a dev reload compiles new models on the same connection and drops the old.
	const hitCollection = () => models().hits.collection
	const aggregateCollection = () => models().aggregates.collection
	const now = options.now ?? currentDate
	const hooks = options.hooks
	const setFoldHits = options.setFoldHits ?? SET_FOLD_HITS
	const state = mongoStateStore(() => models().state, { now })
	const twinWindowMs = options.twinWindowMs === undefined ? TWIN_WINDOW_MS : options.twinWindowMs
	const twinsOf = (): TwinLookup => ({
		from: hitCollection().collectionName,
		windowMs: twinWindowMs,
	})
	const documentsOf = diskUseFallback()
	// Asked at once, so a server too old is said at boot rather than at the first count.
	const supported: Promise<string | null> = (options.serverVersion?.() ?? Promise.resolve(null))
		.then(mongoVersionRefusal)
		.catch(() => null)
	void supported.then((refusal) => {
		if (refusal !== null) {
			options.warn?.(refusal)
		}
	})
	/** Refuses, on a server too old, the reads and counts that cut visits. */
	const checkServer = async (): Promise<void> => {
		const refusal = await supported
		if (refusal !== null) {
			throw new SourceMisconfiguredError(refusal)
		}
	}

	/** The ids of up to `limit` documents `match` selects, so a delete removes a bounded chunk. */
	const idsOf = async (
		collection: Aggregating,
		match: Record<string, unknown>,
		limit: number
	): Promise<unknown[]> => {
		const docs = await documentsOf(
			collection,
			[{ $match: match }, { $limit: limit }, { $project: { _id: 1 } }],
			DISK_USE
		)
		return docs.flatMap((doc) => (isRecord(doc) && doc._id !== undefined ? [doc._id] : []))
	}
	const writer: GenerationWriter = {
		async gens(window) {
			return distinctStrings(await aggregateCollection().distinct('gen', dayRowsFilter(window)))
		},
		async write(records) {
			await aggregateCollection().bulkWrite(
				records.map((record) => {
					const doc = aggregateDocumentOf(record)
					return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }
				}),
				{ ordered: false }
			)
		},
		async drop(window, gens) {
			await aggregateCollection().deleteMany({ ...dayRowsFilter(window), gen: { $in: [...gens] } })
		},
	}

	/** Each share of a read's generations (see {@link GENS_PER_PIPELINE}), its documents read. */
	const perShare = async (
		gens: ReadonlyMap<string, string>,
		pipeline: (share: readonly string[]) => Stage[]
	): Promise<unknown[][]> => {
		const answered: unknown[][] = []
		for (const share of chunksOf([...new Set(gens.values())], GENS_PER_PIPELINE)) {
			answered.push(await documentsOf(aggregateCollection(), pipeline(share), DISK_USE))
		}
		return answered
	}
	const features = {
		aggregates: true,
		rawAnyRange: false,
		filters: rawFilterMap(['eq', 'contains', 'matches']),
	}

	/**
	 * The visitors every condition of a plan keeps, listed first so the read cuts their visits
	 * alone; null keeps everyone, when no condition keeps few enough to be worth naming.
	 */
	const keptVisitorsOf = async (
		plan: RawPlan,
		timed: () => AggregateOptions
	): Promise<KeptVisitors[] | null> => {
		const found: Array<Map<string, Visitor>> = []
		for (const condition of plan.visitors) {
			const docs = await documentsOf(
				hitCollection(),
				keptVisitorsPipeline(plan, condition, KEPT_VISITORS_LIMIT),
				timed()
			)
			if (docs.length <= KEPT_VISITORS_LIMIT) {
				found.push(visitorsOf(docs))
			}
		}
		const [first, ...rest] = found
		if (!first) {
			return null
		}
		const kept = [...first]
			.filter(([key]) => rest.every((visitors) => visitors.has(key)))
			.map(([, visitor]) => visitor)
		return groupKept(kept, plan.read.scope !== undefined)
	}

	const readRaw = async (read: RawRead): Promise<RawRow[]> => {
		await checkServer()
		const plan = planRawRead(read, { id: 'mongo', filters: features.filters })
		if (fillsNothing(plan)) {
			return []
		}
		const timed = deadlineOptions(read.timeoutMs)
		try {
			const kept = await keptVisitorsOf(plan, timed)
			if (kept !== null && kept.length === 0) {
				return rowsOf([], plan)
			}
			const docs = await documentsOf(
				hitCollection(),
				rawReadPipeline(plan, twinsOf(), kept),
				timed()
			)
			return rowsOf(docs, plan)
		} catch (err) {
			if (isStatementTimeout(err)) {
				throw new ReadTimeoutError('mongo', read.timeoutMs, { cause: err })
			}
			throw patternFault(err)
		}
	}

	return {
		id: 'mongo',
		features,
		async append(hits) {
			const { unique } = distinctHits(hits)
			let written = 0
			for (const chunk of chunksOf(unique, HIT_CHUNK)) {
				try {
					await hitCollection().insertMany(chunk.map(hitDocumentOf), { ordered: false })
					written += chunk.length
				} catch (error) {
					const duplicates = duplicatesOf(error)
					if (duplicates === null) {
						throw error
					}
					written += chunk.length - duplicates
				}
			}
			return { written, duplicates: hits.length - written }
		},
		async hitById(id) {
			return hitOf(await hitCollection().findOne({ _id: id }, {}))
		},
		async latestLanding(probe) {
			const [found] = await documentsOf(
				hitCollection(),
				[
					{
						$match: {
							scope: probe.scope,
							ts: { $gte: probe.start, $lte: probe.end },
							hostname: probe.hostname,
							v: probe.v,
							type: 'pageview',
							landing: true,
						},
					},
					{ $sort: { ts: -1, _id: -1 } },
					{ $limit: 1 },
				],
				{ maxTimeMS: LANDING_TIMEOUT_MS }
			).catch((err: unknown) => {
				// Too many hits before it to find in time: the sale keeps its own attribution.
				if (isStatementTimeout(err)) {
					return []
				}
				throw err
			})
			return hitOf(found)
		},
		async ordersIn(window) {
			const { after } = window
			const docs = await documentsOf(
				hitCollection(),
				[
					{
						$match: {
							...windowMatch(window),
							_id: ORDER_RANGE,
							...(after === undefined
								? {}
								: { $or: [{ ts: { $gt: after.ts } }, { ts: after.ts, _id: { $gt: after.id } }] }),
						},
					},
					{ $sort: { ts: 1, _id: 1 } },
					{ $limit: checkLimit(window.limit) },
					{ $project: { ts: 1 } },
				],
				DISK_USE
			)
			return docs.flatMap((doc) => {
				const ts = isRecord(doc) ? dateOf(doc.ts) : null
				return isRecord(doc) && typeof doc._id === 'string' && ts !== null
					? [{ id: doc._id, ts }]
					: []
			})
		},
		readRaw,
		realtime: (read) => readRealtime(readRaw, read),
		async hasHits(window) {
			const found = await hitCollection().findOne(windowMatch(window), {
				projection: { _id: 1 },
			})
			return isRecord(found)
		},
		async countHits(window, atMost) {
			const [counted] = await documentsOf(
				hitCollection(),
				[{ $match: windowMatch(window) }, { $limit: checkCountBound(atMost) + 1 }, { $count: 'n' }],
				DISK_USE
			)
			return countIn(counted)
		},
		async countEach(scopes, window, atMost) {
			const limit = checkCountBound(atMost) + 1
			const counts = new Map<string, number>()
			const counted = (scope: string, index: number): Stage[] => [
				{ $match: windowMatch({ ...window, scope }) },
				{ $limit: limit },
				{ $count: 'n' },
				{ $set: { s: index } },
			]
			for (const chunk of chunksOf([...new Set(scopes)], COUNT_CHUNK)) {
				const [first, ...rest] = chunk
				if (first === undefined) {
					continue
				}
				// One bounded count per scope off the `(scope, ts)` index, in one command.
				const docs = await documentsOf(
					hitCollection(),
					[
						...counted(first, 0),
						...rest.map((scope, index) => ({
							$unionWith: {
								coll: hitCollection().collectionName,
								pipeline: counted(scope, index + 1),
							},
						})),
					],
					DISK_USE
				)
				for (const [index, scope] of chunk.entries()) {
					counts.set(scope, countIn(docs.find((doc) => isRecord(doc) && doc.s === index)))
				}
			}
			return counts
		},
		async scopes() {
			return distinctStrings(await hitCollection().distinct('scope', {})).sort(compareCodePoints)
		},
		async aggregateDay(window, run) {
			checkDayWindow(window)
			const { caps, itemPages } = checkRun(run)
			await checkServer()
			const marker = await heldMarker(state, window, run.runId)
			if (!marker) {
				return refusedRun(0)
			}
			// Only a count a read started has a timeout, shared by its pipelines.
			const timed = deadlineOptions(run.timeoutMs)
			const [count] = await documentsOf(hitCollection(), dayHitsPipeline(window), timed())
			const hits = countIn(count)
			const read = (fold: 'sets' | 'visitors'): Promise<unknown[]> =>
				documentsOf(
					hitCollection(),
					dayAggregationPipeline(window, { itemPages, fold, twins: twinsOf(), caps }),
					timed()
				)
			const docs = options.perVisitor
				? await read('visitors')
				: await read('sets').catch((err: unknown) => {
						if (hits <= setFoldHits || !isMongoOverLimit(err)) {
							throw err
						}
						return read('visitors')
					})
			const rows = capDay(dayRowsOf(docs), caps)
			await hooks?.beforeWrite?.()
			return writeBeside({
				state,
				writer,
				window,
				run: { runId: run.runId, status: run.status, gen: marker.gen },
				rows,
				hits,
				now,
				hooks,
			})
		},
		async readAggregates(read) {
			const plan = planAggregateRead(read)
			if (fillsNothing(plan)) {
				return []
			}
			// Over many shares, each is read whole, then summed, ranked and cut as one.
			const { limit: _limit, ...unlimited } = plan.read
			const whole: AggregatePlan = { ...plan, read: unlimited }
			return readStable({
				gens: () => generationsOf(models().state, read),
				async rows(gens) {
					if (gens.size <= GENS_PER_PIPELINE) {
						const [docs = []] = await perShare(gens, (share) => aggregateReadPipeline(plan, share))
						return aggregateRowsOf(docs, plan)
					}
					const shares = await perShare(gens, (share) => aggregateReadPipeline(whole, share))
					return mergeAggregateRows(
						plan,
						shares.flatMap((docs) => rowsOfDocs(docs, whole))
					)
				},
			})
		},
		async foldedDays(read) {
			const kind = planFoldRead(read)
			return readStable({
				gens: () => generationsOf(models().state, read),
				async rows(gens) {
					const docs = (await perShare(gens, (share) => foldReadPipeline(read, kind, share))).flat()
					return foldedDaysOf(
						kind,
						read,
						docs.filter(isRecord).map((doc) => ({
							day: numberOf(doc.day) ?? 0,
							hostname: textOf(doc.hostname) ?? '',
							value: textOf(doc.value) ?? '',
							value2: textOf(doc.value2) ?? '',
						}))
					)
				},
			})
		},
		async hostnames(scope, since) {
			const hosts = await aggregateCollection().distinct('hostname', {
				scope,
				dim: '',
				dim2: '',
				day: { $gte: since },
			})
			return distinctStrings(hosts).sort(compareCodePoints)
		},
		async oldestHit(scope) {
			const found = await hitCollection().findOne(
				{ scope },
				{ sort: { ts: 1 }, projection: { ts: 1 } }
			)
			return isRecord(found) ? dateOf(found.ts) : null
		},
		async pruneHits(chunk) {
			const limit = checkLimit(chunk.limit)
			const ts = { ...(chunk.from === undefined ? {} : { $gte: chunk.from }), $lt: chunk.before }
			const deletable = await idsOf(
				hitCollection(),
				{ scope: chunk.scope, ts, _id: { $not: ORDER_RANGE } },
				limit
			)
			const deleted = await deleteIds(hitCollection(), deletable)
			if (deletable.length >= limit) {
				return deleted
			}
			const orders = await idsOf(
				hitCollection(),
				{ scope: chunk.scope, ts, _id: ORDER_RANGE, $or: HOLDS_VISIT },
				limit - deletable.length
			)
			return orders.length === 0
				? deleted
				: deleted +
						modifiedOf(
							await hitCollection().updateMany(
								{ _id: { $in: orders } },
								{ $set: { v: '' }, $unset: TOMBSTONE_UNSET }
							)
						)
		},
		async expireOrders(chunk) {
			const ids = await idsOf(
				hitCollection(),
				{ scope: chunk.scope, ts: { $lt: chunk.before }, _id: ORDER_RANGE },
				checkLimit(chunk.limit)
			)
			return deleteIds(hitCollection(), ids)
		},
		async pruneAggregates(chunk) {
			const ids = await idsOf(
				aggregateCollection(),
				{ scope: chunk.scope, day: { $lt: chunk.beforeDay } },
				checkLimit(chunk.limit)
			)
			return deleteIds(aggregateCollection(), ids)
		},
		async sweepGenerations(day, keep) {
			return deletedOf(
				await aggregateCollection().deleteMany({ ...dayRowsFilter(day), gen: { $ne: keep } })
			)
		},
		async reclassify(run) {
			const older = { channelVersion: { $lt: run.version } }
			const found = await documentsOf(
				hitCollection(),
				[
					{ $match: { ...windowMatch(run), ...older } },
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
				],
				DISK_USE
			)
			const groups = channelGroups(
				found.map((doc) => channelTupleOf(isRecord(doc) ? doc._id : undefined)),
				run.classify
			)
			let changed = 0
			for (const slice of windowSlices(run.start, run.end)) {
				for (const [channel, tuples] of groups) {
					for (const chunk of chunksOf(tuples, RECLASSIFY_TUPLES)) {
						const result = await hitCollection().updateMany(
							{
								...windowMatch({ scope: run.scope, ...slice }),
								...older,
								// A null matches the field absent as well as null, which is the null-safe match.
								$or: chunk.map((tuple) => ({ ...tuple })),
							},
							{ $set: { channel, channelVersion: run.version } }
						)
						changed += modifiedOf(result)
					}
				}
			}
			return changed
		},
	}
}
