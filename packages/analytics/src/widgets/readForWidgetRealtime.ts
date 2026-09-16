import type { PayloadRequest } from 'payload'
import type { MetricKey } from '../core/contract'
import { kvCacheStore } from '../surfacing/cacheStore'
import { prepareWidgetRead } from './prepareWidgetRead'
import { readMeta } from './readMeta'

export type WidgetRealtimeStatus = 'ok' | 'not-configured' | 'unavailable'

export interface RealtimePoint {
	date: string
	value: number
}

export interface WidgetRealtimeResult {
	status: WidgetRealtimeStatus
	adapterId: string
	activeNow: number
	series: RealtimePoint[]
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	clamped?: boolean
	stale?: boolean
	filtersUnapplied?: boolean
	goalsUnresolved?: boolean
	/** True when the read hit the source's event scan cap, so the counts are a floor. */
	sampled?: boolean
}

export interface ReadForWidgetRealtimeArgs {
	req: PayloadRequest
	metric: MetricKey
	windowMinutes: number
	adapterId?: string
	now: Date
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
}

const empty = (status: WidgetRealtimeStatus, adapterId: string): WidgetRealtimeResult => ({
	status,
	adapterId,
	activeNow: 0,
	series: [],
})

/**
 * Site-wide realtime read for the "active now" widget. The window arrives as a
 * dateRange (now - windowMinutes -> now). Cached under a realtime-specific key bucketed
 * to the realtime TTL: it is deliberately NOT routed through the engine, whose key
 * day-snaps the range (so a "last 30 min" read would collide with a "today" aggregate).
 */
export const readForWidgetRealtime = async (
	args: ReadForWidgetRealtimeArgs
): Promise<WidgetRealtimeResult> => {
	const { req, metric, windowMinutes, adapterId, now } = args
	const dateRange = { start: new Date(now.getTime() - windowMinutes * 60_000), end: now }
	const prepared = await prepareWidgetRead({
		req,
		now,
		range: dateRange,
		adapterId,
		scope: args.scope,
		requires: { realtime: true },
	})
	if (!prepared.ok) {
		// The window carries no filters, so `filter-unsupported` cannot arise here.
		const status = prepared.status === 'not-configured' ? 'not-configured' : 'unavailable'
		return empty(status, prepared.adapterId)
	}
	const { runtime, adapter, queryScope } = prepared
	// The capability says the source counts live visitors; the hook is what reads them.
	const realtime = adapter.realtime
	if (!realtime) {
		return empty('unavailable', adapter.id)
	}

	const ttlSeconds = runtime.ttl.realtime ?? adapter.capabilities.recommendedTtl.realtime
	const bucket = Math.floor(now.getTime() / 1000 / Math.max(1, ttlSeconds))
	const scopeKey = queryScope === undefined ? '' : `:${encodeURIComponent(queryScope)}`
	const key = `rt:${adapter.id}:${metric}:${windowMinutes}:${bucket}${scopeKey}`
	const store = kvCacheStore(req.payload.kv)
	const cached = await store.get<WidgetRealtimeResult>(key)
	if (cached) {
		return cached
	}

	const result = await realtime({ metrics: [metric], dateRange, scope: queryScope }, {})
	const out: WidgetRealtimeResult = {
		status: 'ok',
		adapterId: adapter.id,
		activeNow: result.totals?.[metric] ?? 0,
		series: result.rows.map((r) => ({ date: r.timestamp ?? '', value: r.metrics[metric] ?? 0 })),
		...readMeta(result),
	}
	await store.set(key, out, ttlSeconds)
	return out
}
