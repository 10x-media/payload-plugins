import { currentDate } from '../../../core/clock'
import { isStatementTimeout } from '../../../db/errors'
import { DEFAULT_STORE_SLUGS, type StoreSlugs } from '../../collections/slugs'
import {
	type AggregatePlan,
	capDay,
	checkDayWindow,
	checkRun,
	type DayRow,
	dayRowOf,
	emptyAggregateRow,
	foldedDaysOf,
	type GenerationWriter,
	heldMarker,
	partsOfSums,
	planAggregateRead,
	planFoldRead,
	refusedRun,
	writeBeside,
} from '../aggregate'
import { checkLimit, chunksOf, mapInSlices, yieldToLoop } from '../chunks'
import { dateOf, numberOf, textOf } from '../columnValues'
import { hitRowOf } from '../hitRow'
import { distinctHits, HIT_CHUNK } from '../hits'
import { patternFault } from '../pattern'
import {
	checkCountBound,
	compareCodePoints,
	fillsNothing,
	partsFrom,
	planRawRead,
	type RawPlan,
	ReadTimeoutError,
	rawFilterMap,
	readRealtime,
	readWindow,
} from '../rawRead'
import { channelGroups, channelTupleOf, RECLASSIFY_TUPLES, windowSlices } from '../reclassify'
import type {
	AggregateHooks,
	AggregateRow,
	DayWindow,
	EventStore,
	HitRow,
	RawRead,
	RawRow,
} from '../types'
import {
	type AggregateTarget,
	compileAggregateInsert,
	compileAggregateRead,
	compileDayAggregation,
	compileDayGens,
	compileDayRowsDelete,
	compileFoldRead,
	compileHostnames,
	HITS_KIND,
} from './aggregateSql'
import { HIT_COLUMNS } from './columns'
import {
	column,
	compileHasHits,
	compileHitById,
	compileLatestLanding,
	compileOrdersIn,
	compileRangeCount,
	compileRangeCounts,
	compileRawRead,
	compileScopes,
} from './compile'
import type { TransactionOptions } from './drivers'
import type { SqlExecutor, SqlRow } from './executor'
import { ident, join, json, NULL, type SqlFragment, sql } from './fragment'
import {
	compileChannelTuples,
	compileExpireOrders,
	compileOldestHit,
	compilePruneAggregates,
	compilePruneHits,
	compileReclassify,
	compileTombstones,
} from './maintenanceSql'
import { PoolWaitTimeoutError } from './poolShare'
import { MAIN_THREAD_STALL_MS } from './sqliteThread'
import { type SqlStateStore, sqlStateStore } from './sqlState'

const isHitField = (key: string): key is keyof HitRow => Object.hasOwn(HIT_COLUMNS, key)

const HIT_FIELDS: ReadonlyArray<keyof HitRow> = Object.keys(HIT_COLUMNS).filter(isHitField)

const hitOfRow = (row: SqlRow): HitRow | null => hitRowOf((field) => row[HIT_COLUMNS[field]])

const COLUMN_LIST = join(HIT_FIELDS.map((field) => column(field)))

const cell = (value: HitRow[keyof HitRow]): SqlFragment => {
	if (value === undefined) {
		return NULL
	}
	if (value instanceof Date || typeof value !== 'object') {
		return sql`${value}`
	}
	return json(value)
}

const valuesOf = (hit: HitRow): SqlFragment =>
	sql`(${join(HIT_FIELDS.map((field) => cell(hit[field])))})`

/**
 * Hits SQLite reads per millisecond of a read's time, set low: libsql cannot interrupt a statement,
 * so a read too big for its time is refused before it starts rather than stopped.
 */
export const SQLITE_HITS_PER_MS = { plain: 200, visits: 40 } as const

const rawRowsOf = (rows: readonly SqlRow[], plan: RawPlan): RawRow[] => {
	if (plan.group === undefined && plan.read.buckets === undefined) {
		const [row] = rows
		return [{ value: null, parts: partsFrom(plan.counted, (part) => numberOf(row?.[part])) }]
	}
	return rows.map((row) => ({
		value: plan.group === undefined ? null : textOf(row.value),
		...(plan.read.buckets === undefined ? {} : { bucket: numberOf(row.bucket) ?? 0 }),
		parts: partsFrom(plan.counted, (part) => numberOf(row[part])),
	}))
}

/**
 * Rows of a day's count turned into records per slice of the event loop: a busy day has tens of
 * thousands, each hashed for its id, which at once would hold the thread for most of a second.
 */
const SLICE = 2_000

/** Scopes one statement counts the hits of, well under the bound parameter limits. */
const COUNT_CHUNK = 500

/** A day's rows one delete removes at most, so a writer waits out no more than that. */
export const DAY_DELETE_CHUNK = 2_000

/** A day's read answered: its rows, uncapped, and how many hits it counted. */
const dayOf = async (rows: readonly SqlRow[]): Promise<{ rows: DayRow[]; hits: number }> => {
	let hits = 0
	const counted = await mapInSlices(rows, SLICE, (row): DayRow | undefined => {
		const kind = numberOf(row.k)
		if (kind === HITS_KIND) {
			hits = numberOf(row.pageviews) ?? 0
			return undefined
		}
		if (kind === null) {
			return undefined
		}
		return dayRowOf(
			{
				kind,
				hostname: textOf(row.hostname) ?? '',
				value: textOf(row.v1) ?? '',
				value2: textOf(row.v2) ?? '',
				folded: numberOf(row.o) === 1,
			},
			(part) => numberOf(row[part])
		)
	})
	return { rows: counted.filter((row) => row !== undefined), hits }
}

const aggregateRowsOf = (rows: readonly SqlRow[], plan: AggregatePlan): AggregateRow[] => {
	const partsOf = (row: SqlRow) => partsOfSums((part) => numberOf(row[part]))
	if (plan.group === null) {
		const [row] = rows
		return [
			row && (numberOf(row.n) ?? 0) > 0
				? { value: null, parts: partsOf(row) }
				: emptyAggregateRow(plan),
		]
	}
	return rows.map((row) =>
		plan.group === 'day'
			? { value: null, day: numberOf(row.day) ?? 0, parts: partsOf(row) }
			: { value: textOf(row.value), parts: partsOf(row) }
	)
}

export interface SqlStoreOptions {
	/** The day markers and leases on the same database; built on the executor by default. */
	state?: SqlStateStore
	/** The clock runs are stamped with; the plugin's clock (`currentDate`) by default. */
	now?: () => Date
	hooks?: AggregateHooks
	slugs?: StoreSlugs
	/** How far apart an order's two records may lie as one sale; `TWIN_WINDOW_MS` by default. */
	twinWindowMs?: number | null
}

/**
 * The hit store on Postgres or SQLite, on the adapter's own pool or client and never inside a
 * transaction the host holds open. Stored ids are left alone, so rows changed are rows written.
 */
export const sqlEventStore = (executor: SqlExecutor, options: SqlStoreOptions = {}): EventStore => {
	const { dialect } = executor
	const slugs = options.slugs ?? DEFAULT_STORE_SLUGS
	const target = {
		dialect,
		hits: executor.table(slugs.hits),
		...(options.twinWindowMs === undefined ? {} : { twinWindowMs: options.twinWindowMs }),
	}
	const now = options.now ?? currentDate
	const state = options.state ?? sqlStateStore(executor, { now, slug: slugs.state })
	const hooks = options.hooks
	const tables: AggregateTarget = {
		...target,
		aggregates: executor.table(slugs.aggregates),
		state: executor.table(slugs.state),
	}
	const id = dialect.name
	const features = {
		aggregates: true,
		rawAnyRange: false,
		filters: rawFilterMap(dialect.matches ? ['eq', 'contains', 'matches'] : ['eq', 'contains']),
	}

	/**
	 * A long read: on Postgres in a transaction of its own, under the dialect's analytical settings;
	 * on SQLite on the worker thread for its `kind`, when it has worker threads.
	 */
	const selectLong = (
		statement: SqlFragment,
		kind: 'long' | 'count',
		bound: Pick<TransactionOptions, 'timeoutMs' | 'signal'> = {}
	): Promise<SqlRow[]> =>
		dialect.name === 'postgres'
			? executor.transaction((tx) => tx.select(statement), { analytical: true, ...bound })
			: executor.select(statement, kind)

	/** Postgres cancels the statement itself at the read's limit. */
	const selectTimed = async (
		statement: SqlFragment,
		timeoutMs: number,
		signal?: AbortSignal
	): Promise<SqlRow[]> => {
		try {
			return await selectLong(statement, 'long', { timeoutMs, ...(signal ? { signal } : {}) })
		} catch (err) {
			if (isStatementTimeout(err) || err instanceof PoolWaitTimeoutError) {
				throw new ReadTimeoutError(id, timeoutMs, { cause: err })
			}
			throw err
		}
	}

	/** How long one statement may hold up this thread: set on SQLite's main thread alone. */
	const blockingBudgetMs = async (): Promise<number | null> =>
		(await executor.blocking()) ? MAIN_THREAD_STALL_MS : null

	/**
	 * SQLite counts the window off its index first, and refuses a read it could not finish in time,
	 * or on the main thread one that would hold it up longer than a statement may.
	 */
	const selectBounded = async (statement: SqlFragment, plan: RawPlan): Promise<SqlRow[]> => {
		const { read } = plan
		const rate = plan.sessionize ? SQLITE_HITS_PER_MS.visits : SQLITE_HITS_PER_MS.plain
		const stall = await blockingBudgetMs()
		const allowedMs = Math.min(read.timeoutMs, stall ?? read.timeoutMs)
		const budget = allowedMs * rate
		const [counted] = await executor.select(
			compileRangeCount(readWindow(read, plan.from), target, budget),
			'long'
		)
		if ((numberOf(counted?.n) ?? 0) > budget) {
			throw new ReadTimeoutError(id, allowedMs, { refused: true })
		}
		return executor.select(statement, 'long')
	}

	/** Deletes the day's rows `which` names, a share per statement, answering how many. */
	const deleteDayRows = async (
		window: Pick<DayWindow, 'scope' | 'day'>,
		which: { gens: readonly string[] } | { keep: string }
	): Promise<number> => {
		let deleted = 0
		for (;;) {
			const { rowCount } = await executor.execute(
				compileDayRowsDelete(window, { ...which, limit: DAY_DELETE_CHUNK }, tables)
			)
			deleted += rowCount
			if (rowCount < DAY_DELETE_CHUNK) {
				return deleted
			}
		}
	}

	/** A day's rows beside the readable ones, a chunk per statement: a host write waits one out. */
	const writer: GenerationWriter = {
		async gens(window) {
			const rows = await executor.select(compileDayGens(window, tables))
			return rows.map((row) => textOf(row.gen)).filter((gen) => gen !== null)
		},
		async write(records) {
			await executor.execute(compileAggregateInsert(records, tables))
		},
		async drop(window, gens) {
			if (gens.length > 0) {
				await deleteDayRows(window, { gens })
			}
		},
	}

	const readRaw = async (read: RawRead): Promise<RawRow[]> => {
		const plan = planRawRead(read, { id, filters: features.filters })
		if (fillsNothing(plan)) {
			return []
		}
		const statement = compileRawRead(plan, target)
		const rows = await (dialect.name === 'postgres'
			? selectTimed(statement, read.timeoutMs, read.signal)
			: selectBounded(statement, plan)
		).catch((err: unknown) => {
			throw patternFault(err)
		})
		return rawRowsOf(rows, plan)
	}

	return {
		id,
		features,
		blockingBudgetMs,
		async append(hits) {
			// One order of ids in every statement: two writers holding some of the same ids then never
			// wait on each other's uncommitted rows in a cycle, which Postgres would end as a deadlock.
			const unique = distinctHits(hits).unique.sort((x, y) => (x.id < y.id ? -1 : 1))
			const { results } = await executor.batch(
				chunksOf(unique, HIT_CHUNK).map((chunk) => ({
					statement: sql`INSERT INTO ${target.hits} (${COLUMN_LIST}) VALUES ${join(chunk.map(valuesOf))}
						ON CONFLICT (${ident('id')}) DO NOTHING`,
				}))
			)
			const written = results.reduce((sum, result) => sum + result.rowCount, 0)
			return { written, duplicates: hits.length - written }
		},
		async hitById(hit) {
			const [row] = await executor.select(compileHitById(hit, target))
			return row === undefined ? null : hitOfRow(row)
		},
		async latestLanding(probe) {
			const [row] = await executor.select(compileLatestLanding(probe, target))
			return row === undefined ? null : hitOfRow(row)
		},
		async ordersIn(window) {
			const rows = await executor.select(
				compileOrdersIn({ ...window, limit: checkLimit(window.limit) }, target)
			)
			return rows.flatMap((row) => {
				const ts = dateOf(row.ts)
				return typeof row.id === 'string' && ts !== null ? [{ id: row.id, ts }] : []
			})
		},
		readRaw,
		realtime: (read) => readRealtime(readRaw, read),
		async hasHits(window) {
			return (await executor.select(compileHasHits(window, target))).length > 0
		},
		async countHits(window, atMost) {
			const [row] = await executor.select(
				compileRangeCount(window, target, checkCountBound(atMost)),
				'long'
			)
			return numberOf(row?.n) ?? 0
		},
		async countEach(scopes, window, atMost) {
			const limit = checkCountBound(atMost)
			const counts = new Map<string, number>()
			for (const chunk of chunksOf([...new Set(scopes)], COUNT_CHUNK)) {
				const rows = await executor.select(
					compileRangeCounts({ ...window, scopes: chunk }, target, limit),
					'long'
				)
				for (const row of rows) {
					const scope = textOf(row.scope)
					const n = numberOf(row.n)
					if (scope !== null && n !== null) {
						counts.set(scope, n)
					}
				}
			}
			return counts
		},
		async scopes() {
			const rows = await executor.select(compileScopes(target), 'long')
			return rows
				.map((row) => textOf(row.scope))
				.filter((scope) => scope !== null)
				.sort(compareCodePoints)
		},
		async aggregateDay(window, run) {
			checkDayWindow(window)
			const { caps, itemPages } = checkRun(run)
			const marker = await heldMarker(state, window, run.runId)
			if (!marker) {
				return refusedRun(0)
			}
			const day = await dayOf(
				await selectLong(
					compileDayAggregation(window, target, { itemPages, caps }),
					'count',
					run.timeoutMs === undefined ? {} : { timeoutMs: run.timeoutMs }
				)
			)
			const rows = capDay(day.rows, caps)
			await yieldToLoop()
			await hooks?.beforeWrite?.()
			return writeBeside({
				state,
				writer,
				window,
				run: { runId: run.runId, status: run.status, gen: marker.gen },
				rows,
				hits: day.hits,
				now,
				hooks,
			})
		},
		async readAggregates(read) {
			const plan = planAggregateRead(read)
			if (fillsNothing(plan)) {
				return []
			}
			return aggregateRowsOf(
				await executor.select(compileAggregateRead(plan, tables), 'long', read.signal),
				plan
			)
		},
		async foldedDays(read) {
			const kind = planFoldRead(read)
			const rows = await executor.select(compileFoldRead(read, kind, tables), 'long')
			return foldedDaysOf(
				kind,
				read,
				rows.map((row) => ({
					day: numberOf(row.day) ?? 0,
					hostname: textOf(row.hostname) ?? '',
					value: textOf(row.value) ?? '',
					value2: textOf(row.value2) ?? '',
				}))
			)
		},
		async hostnames(scope, since) {
			const rows = await executor.select(compileHostnames(scope, since, tables), 'long')
			return rows
				.map((row) => textOf(row.hostname))
				.filter((host) => host !== null)
				.sort(compareCodePoints)
		},
		async oldestHit(scope) {
			const [row] = await executor.select(compileOldestHit(scope, target))
			return dateOf(row?.ts)
		},
		async pruneHits(chunk) {
			const limit = checkLimit(chunk.limit)
			const deleted = (await executor.execute(compilePruneHits(chunk, target))).rowCount
			if (deleted >= limit) {
				return deleted
			}
			const left = { ...chunk, limit: limit - deleted }
			return deleted + (await executor.execute(compileTombstones(left, target))).rowCount
		},
		async expireOrders(chunk) {
			checkLimit(chunk.limit)
			return (await executor.execute(compileExpireOrders(chunk, target))).rowCount
		},
		async pruneAggregates(chunk) {
			checkLimit(chunk.limit)
			return (await executor.execute(compilePruneAggregates(chunk, tables))).rowCount
		},
		sweepGenerations: (day, keep) => deleteDayRows(day, { keep }),
		async reclassify(run) {
			const found = await executor.select(compileChannelTuples(run, run.version, target), 'long')
			const groups = channelGroups(found.map(channelTupleOf), run.classify)
			let changed = 0
			for (const slice of windowSlices(run.start, run.end)) {
				for (const [channel, tuples] of groups) {
					for (const chunk of chunksOf(tuples, RECLASSIFY_TUPLES)) {
						const { rowCount } = await executor.execute(
							compileReclassify(
								{ scope: run.scope, ...slice },
								{ channel, version: run.version, tuples: chunk },
								target
							)
						)
						changed += rowCount
					}
				}
			}
			return changed
		},
	}
}
