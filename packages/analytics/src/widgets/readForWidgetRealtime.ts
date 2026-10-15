import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf } from '../access/principal'
import { buildRealtimeKey } from '../core/cacheKey'
import type { AnalyticsQuery, AnalyticsResult, MetricKey } from '../core/contract'
import { cacheEpochsFor } from '../plugin/runtime'
import { readFailureOf } from '../surfacing/classifyError'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import {
	prepareWidgetRead,
	type StoredSourceRead,
	type SubstitutedSource,
	substitutionOf,
} from './prepareWidgetRead'
import { type ReadNotices, readMeta } from './readMeta'

/**
 * What the live count reports: `unavailable` a source counting no one live, `busy` one that failed
 * to count for now, `misconfigured` and `host-refused` one whose setup refused the read.
 */
export type WidgetRealtimeStatus =
	| 'ok'
	| 'not-configured'
	| 'unavailable'
	| 'busy'
	| 'invalid'
	| 'no-access'
	| 'no-scope'
	| 'misconfigured'
	| 'host-refused'

export interface RealtimePoint {
	date: string
	value: number
}

export interface WidgetRealtimeResult extends Partial<ReadNotices>, SubstitutedSource {
	status: WidgetRealtimeStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	adapterId: string
	/** The window's total for the metric that was asked for, not visitors specifically. */
	activeNow: number
	series: RealtimePoint[]
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	/** The scope the read narrowed to, absent for an install-wide one. */
	scope?: string
}

/** Scoped like `ReadForWidgetArgs`: the request's own scope unless one is pinned. */
export type ReadForWidgetRealtimeArgs = ReadPrincipal &
	StoredSourceRead & {
		req: PayloadRequest
		metric: MetricKey
		windowMinutes: number
		adapterId?: string
		now: Date
		/** Count only the visitors on this path; omitted counts the whole site. */
		path?: string
		/** False reads the window's total alone, its `series` left empty. Default true. */
		series?: boolean
	}

const empty = (status: WidgetRealtimeStatus, adapterId: string): WidgetRealtimeResult => ({
	status,
	adapterId,
	activeNow: 0,
	series: [],
})

/** The live count both callers share; `failed` answers for a source read that throws. */
const readRealtime = async (
	args: ReadForWidgetRealtimeArgs,
	failed: (err: unknown, adapterId: string) => WidgetRealtimeResult
): Promise<WidgetRealtimeResult> => {
	const { req, metric, windowMinutes, adapterId, now, path } = args
	const series = args.series ?? true
	const dateRange = { start: new Date(now.getTime() - windowMinutes * 60_000), end: now }
	// The window is anchored on `now` and never rendered in a zone, so the poll skips the
	// install's timezone resolver rather than paying for it ahead of the cache check.
	const prepared = await prepareWidgetRead({
		req,
		now,
		range: dateRange,
		timezone: DEFAULT_TIMEZONE,
		adapterId,
		...readPrincipalOf(args),
		...(args.fallbackWhenUnreadable ? { fallbackWhenUnreadable: true } : {}),
		requires: { realtime: true },
	})
	if (!prepared.ok) {
		// The window carries no filters, so `filter-unsupported` cannot arise here.
		const status =
			prepared.status === 'not-configured' ||
			prepared.status === 'no-access' ||
			prepared.status === 'no-scope'
				? prepared.status
				: 'unavailable'
		return empty(status, prepared.adapterId)
	}
	const { runtime, adapter, queryScope } = prepared
	// The capability says the source counts live visitors; the hook is what reads them.
	const realtime = adapter.realtime
	if (!realtime) {
		return empty('unavailable', adapter.id)
	}

	const ttlSeconds = runtime.ttl.realtime ?? adapter.capabilities.recommendedTtl.realtime
	// Built outside the engine, so it carries the scope's epochs itself. The path is in it: two
	// pages of one site share everything else, so one page's count would otherwise serve the other's.
	const key = buildRealtimeKey(
		adapter.id,
		{
			metric,
			windowMinutes,
			series,
			...(queryScope === undefined ? {} : { scope: queryScope }),
			...(path === undefined ? {} : { path }),
		},
		await cacheEpochsFor(runtime, queryScope)
	)
	let result: AnalyticsResult | undefined = runtime.memo?.get(key)
	if (!result) {
		const query: AnalyticsQuery = {
			metrics: [metric],
			dateRange,
			scope: queryScope,
			...(path === undefined ? {} : { path }),
			...(series ? { granularity: 'minute' as const } : {}),
		}
		// Through the source's lane like every other read of it, waiting ahead of background work;
		// the native engine's lane stays its own. A runtime built by hand may have no lanes.
		try {
			result = runtime.engine.realtime
				? await runtime.engine.realtime(adapter, query)
				: await realtime.call(adapter, query, { payload: req.payload })
		} catch (err) {
			return failed(err, adapter.id)
		}
		runtime.memo?.set(key, result, ttlSeconds * 1000)
	}
	return {
		status: 'ok',
		adapterId: adapter.id,
		...substitutionOf(prepared),
		activeNow: result.totals?.[metric] ?? 0,
		series: result.rows.map((r) => ({ date: r.timestamp ?? '', value: r.metrics[metric] ?? 0 })),
		...(queryScope === undefined ? {} : { scope: queryScope }),
		...readMeta(result),
	}
}

/**
 * Realtime read for the "active now" widget, memoized in-process only (a by-the-minute count is
 * not worth a cache write) and keyed here, since the engine's key day-snaps the range.
 */
export const readForWidgetRealtime = (
	args: ReadForWidgetRealtimeArgs
): Promise<WidgetRealtimeResult> =>
	readRealtime(args, (err, adapterId) => {
		const { status, retryAfterMs } = readFailureOf(err)
		return {
			...empty(status, adapterId),
			...(retryAfterMs === undefined ? {} : { retryAfterMs }),
		}
	})

/** The same read for the live endpoint, which answers a failed read with its own error response. */
export const readRealtimeOrThrow = (
	args: ReadForWidgetRealtimeArgs
): Promise<WidgetRealtimeResult> =>
	readRealtime(args, (err) => {
		throw err
	})
