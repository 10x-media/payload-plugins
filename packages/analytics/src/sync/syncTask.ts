import type { Payload, PayloadRequest, TaskConfig } from 'payload'
import { metricReaches } from '../core/capabilities'
import { currentDate } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import type { AnalyticsAdapter, AnalyticsResult, AnalyticsRow } from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { type ScheduledTask, TASK_SLUGS } from '../core/jobs'
import { monotonicMs } from '../core/monotonic'
import type { ScopeListResolver } from '../core/options'
import type { AdapterRegistry } from '../core/registry'
import { systemRegistryFor } from '../core/scopedRead'
import { resolveScopeList } from '../core/scopeList'
import { isUniqueViolation } from '../db/errors'
import { DETACHED } from '../db/openTransaction'
import {
	type LeaseHold,
	leaseHeld,
	stateLease,
	stateStoreOf,
	TASK_LEASE_MS,
	underLease,
} from '../maintenance/lease'
import {
	concurrencyFor,
	scheduleFor,
	stuckJobGuard,
	TASK_BUDGET_MS,
	TASK_DEAD_AFTER_MS,
} from '../maintenance/taskSchedule'
import { type AnalyticsRuntime, getRuntime } from '../plugin/runtime'
import { DAY_MS } from '../timeframe/tz'
import { METRIC_FIELDS, type SyncMetric } from './collection'
import { rekeySyncedDurations } from './rekeyDurations'

export const SYNC_TASK_SLUG = TASK_SLUGS.sync

export type SyncRow = { source: string; date: Date; syncedAt: Date; scope: string } & Partial<
	Record<SyncMetric, number | null>
>

export interface SyncTaskOptions {
	schedule: ScheduledTask
	lookbackDays: number
	collectionSlug: string
	/**
	 * Entries match a config adapter id exactly, and a runtime provider instance
	 * (`<provider>:<docId>`) by its provider type.
	 */
	adapterIds?: string[]
	/** Tenant scopes to fan out over, beside the install-wide scope every run covers. */
	scopes?: ScopeListResolver
	/** The host's `jobs.enableConcurrencyControl`; Payload refuses a concurrency key without it. */
	concurrency?: boolean
	/** How long one run works before it leaves the rest to the next; {@link TASK_BUDGET_MS}. */
	budgetMs?: number
	/** Milliseconds the budget is spent in; `monotonicMs` unless a test hands one in. */
	clock?: () => number
}

/**
 * What one run did; `ran` is false when another run held the task's lease and this one did nothing.
 * `finished` is false when its budget ran out first: the next run starts where this one stopped.
 */
export interface SyncTaskOutput {
	ran: boolean
	finished: boolean
	synced: number
	failed: number
}

/** A scope as the task's cursor keeps it: JSON, so the install-wide scope (null) has a spelling. */
const cursorOf = (scope: string | null): string => JSON.stringify(scope)

/** Where in `scopes` a run starts: at the scope the last run stopped at, else at the first. */
export const rotateScopes = (
	scopes: readonly (string | null)[],
	cursor: string | null
): (string | null)[] => {
	const at = cursor === null ? -1 : scopes.findIndex((scope) => cursorOf(scope) === cursor)
	return at <= 0 ? [...scopes] : [...scopes.slice(at), ...scopes.slice(0, at)]
}

/**
 * One daily row as a sync-collection doc; absent metrics are written as null so a day synced again
 * replaces the earlier row's numbers. Null when the row has no usable timestamp.
 */
export const toSyncRow = (
	source: string,
	row: AnalyticsRow,
	opts: { syncedAt: Date; scope?: string }
): SyncRow | null => {
	if (!row.timestamp) {
		return null
	}
	const date = new Date(row.timestamp)
	if (Number.isNaN(date.getTime())) {
		return null
	}
	const doc: SyncRow = { source, date, syncedAt: opts.syncedAt, scope: opts.scope ?? '' }
	for (const metric of METRIC_FIELDS) {
		const value = row.metrics[metric]
		doc[metric] = typeof value === 'number' ? value : null
	}
	return doc
}

/**
 * True when `adapterIds` is unset, lists `adapterId` exactly, or lists the provider type of a
 * runtime instance id (`<provider>:<docId>`).
 */
export const matchesAdapterFilter = (
	adapterIds: string[] | undefined,
	adapterId: string
): boolean => {
	if (!adapterIds) {
		return true
	}
	if (adapterIds.includes(adapterId)) {
		return true
	}
	return adapterIds.includes(adapterId.split(':')[0] ?? adapterId)
}

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/**
 * Upserts one row on the unique (source, date, scope) index. On Postgres and SQLite a first write
 * can lose a race to another run's insert; its unique violation is answered by writing again.
 */
export const upsertSyncRow = async (
	payload: Payload,
	collectionSlug: string,
	row: SyncRow
): Promise<void> => {
	if (!isCollectionSlug(payload, collectionSlug)) {
		throw new Error(`analytics: no "${collectionSlug}" collection is registered for sync`)
	}
	const date = row.date.toISOString()
	const syncedAt = row.syncedAt.toISOString()
	const data: Record<string, unknown> = { ...row, date, syncedAt, updatedAt: syncedAt }
	const write = () =>
		payload.db.upsert({
			collection: collectionSlug,
			data,
			req: DETACHED,
			returning: false,
			select: {},
			where: {
				and: [
					{ source: { equals: row.source } },
					{ date: { equals: date } },
					{ scope: { equals: row.scope } },
				],
			},
		})
	try {
		await write()
	} catch (err) {
		if (!isUniqueViolation(err, payload)) {
			throw err
		}
		await write()
	}
}

interface SyncPass {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	opts: SyncTaskOptions
	hold: LeaseHold
}

const notRan = (): SyncTaskOutput => ({ ran: false, finished: false, synced: 0, failed: 0 })

interface SourceSync {
	runtime: AnalyticsRuntime
	payload: Payload
	collectionSlug: string
	scope: string | null
	dateRange: { start: Date; end: Date }
	syncedAt: Date
	warn: (message: string) => void
}

/** Reads one source's daily metrics for a scope and upserts them, counting rows written and lost. */
const syncSource = async (
	adapter: AnalyticsAdapter,
	sync: SourceSync
): Promise<{ synced: number; failed: number }> => {
	const { capabilities } = adapter
	if (!adapter.isConfigured() || !supportsGranularity(capabilities, 'day')) {
		return { synced: 0, failed: 0 }
	}
	const metrics = METRIC_FIELDS.filter(
		(m) => capabilities.metrics.has(m) && metricReaches(capabilities, m, {})
	)
	if (metrics.length === 0) {
		return { synced: 0, failed: 0 }
	}
	const { scope, warn } = sync
	let result: AnalyticsResult
	try {
		// No stale answer (one means the refresh failed), background priority so admin readers go
		// first, and the source's own numbers, not what hooks.afterRead makes of them for a reader.
		result = await sync.runtime.engine.read(
			adapter,
			{ metrics, dateRange: sync.dateRange, granularity: 'day', scope: scope ?? undefined },
			{ allowStale: false, priority: 'background', afterRead: false }
		)
	} catch (err) {
		warn(
			`analytics sync: adapter "${adapter.id}" read failed (scope "${scope ?? ''}"): ${String(err)}`
		)
		return { synced: 0, failed: 1 }
	}
	if (result.meta.stale) {
		warn(
			`analytics sync: adapter "${adapter.id}" read was stale-served, skipping sync (scope "${scope ?? ''}")`
		)
		return { synced: 0, failed: 1 }
	}
	let synced = 0
	let failed = 0
	for (const row of result.rows) {
		const doc = toSyncRow(adapter.id, row, { syncedAt: sync.syncedAt, scope: scope ?? '' })
		if (!doc) {
			continue
		}
		try {
			await upsertSyncRow(sync.payload, sync.collectionSlug, doc)
			synced++
		} catch (err) {
			failed++
			warn(
				`analytics sync: upsert for "${adapter.id}" on ${doc.date.toISOString()} failed: ${String(err)}`
			)
		}
	}
	return { synced, failed }
}

/**
 * Syncs every listed scope's vendor sources within the run's budget. A run cut short records where
 * it stopped in `analytics-state` and the next starts there, so no scope starves.
 */
const syncAll = async ({ runtime, req, opts, hold }: SyncPass): Promise<SyncTaskOutput> => {
	const now = currentDate()
	const clock = opts.clock ?? monotonicMs
	const deadline = clock() + (opts.budgetMs ?? TASK_BUDGET_MS)
	const going = (): boolean => !hold.lost() && clock() < deadline
	const dateRange = {
		start: new Date(startOfUtcDay(now).getTime() - (opts.lookbackDays - 1) * DAY_MS),
		end: now,
	}
	let synced = 0
	let failed = 0
	const warn = (message: string) => req.payload.logger.warn(message)
	const state = stateStoreOf(req.payload)
	const cursor = await (state?.cursor(SYNC_TASK_SLUG) ?? Promise.resolve(null)).catch(
		(err: unknown) => {
			warn(`analytics sync: reading where the last run stopped failed: ${String(err)}`)
			return null
		}
	)
	if (state) {
		const rekeyed = await rekeySyncedDurations({
			payload: req.payload,
			collectionSlug: opts.collectionSlug,
			state,
			now,
			going,
		}).catch((err: unknown) => {
			warn(`analytics sync: moving stored visit durations failed: ${String(err)}`)
			return { moved: 0, finished: true }
		})
		if (!rekeyed.finished) {
			return { ran: true, finished: false, synced: 0, failed }
		}
	}
	const scopeList = rotateScopes(await resolveScopeList(opts.scopes, req.payload), cursor)
	/** The scope a run cut short stopped at; undefined once every scope was synced. */
	let stoppedAt: string | null | undefined
	scopes: for (const scope of scopeList) {
		if (!going()) {
			stoppedAt = scope
			break
		}
		// Reads as SYSTEM: the scope's own sources, never a shared one that cannot narrow to the
		// tenant, whose install-wide totals would be stamped as this scope's row.
		let registry: AdapterRegistry | null
		try {
			registry = await systemRegistryFor(runtime, req, scope)
		} catch (err) {
			failed++
			warn(
				`analytics sync: registry resolution failed for scope "${scope ?? 'install-wide'}": ${String(err)}`
			)
			continue
		}
		for (const adapter of registry?.all() ?? []) {
			if (!going()) {
				stoppedAt = scope
				break scopes
			}
			if (adapter.id === 'native' || !matchesAdapterFilter(opts.adapterIds, adapter.id)) {
				continue
			}
			const counts = await syncSource(adapter, {
				runtime,
				payload: req.payload,
				collectionSlug: opts.collectionSlug,
				scope,
				dateRange,
				syncedAt: now,
				warn,
			})
			synced += counts.synced
			failed += counts.failed
		}
	}
	await state
		?.setCursor(SYNC_TASK_SLUG, stoppedAt === undefined ? null : cursorOf(stoppedAt))
		.catch((err: unknown) =>
			warn(`analytics sync: recording where this run stopped failed: ${String(err)}`)
		)
	return { ran: true, finished: stoppedAt === undefined, synced, failed }
}

/**
 * `analytics-sync`: writes each vendor source's last `lookbackDays` of daily metrics into the sync
 * collection, install-wide and per scope; one source failing never stops the rest.
 */
export const syncTask = (
	opts: SyncTaskOptions
): TaskConfig<{ input: Record<string, never>; output: SyncTaskOutput }> => ({
	slug: SYNC_TASK_SLUG,
	retries: 0,
	handler: async ({ req }) => {
		const runtime = getRuntime(req.payload)
		if (!runtime) {
			return { output: notRan() }
		}
		const warn = (message: string) => req.payload.logger.warn(message)
		const outcome = await underLease(
			{ lease: stateLease(req.payload, SYNC_TASK_SLUG, TASK_LEASE_MS), ttlMs: TASK_LEASE_MS, warn },
			(hold) => syncAll({ runtime, req, opts, hold })
		)
		if (!outcome.ran) {
			return { output: notRan() }
		}
		await stateStoreOf(req.payload)
			?.beat(SYNC_TASK_SLUG)
			.catch((err: unknown) =>
				warn(`analytics sync: stamping its heartbeat failed: ${String(err)}`)
			)
		return { output: outcome.value }
	},
	...scheduleFor(
		opts.schedule,
		stuckJobGuard({
			slug: SYNC_TASK_SLUG,
			deadAfterMs: TASK_DEAD_AFTER_MS,
			alive: (req) => leaseHeld(req.payload, SYNC_TASK_SLUG),
		})
	),
	...concurrencyFor('sync', opts.concurrency === true),
})
