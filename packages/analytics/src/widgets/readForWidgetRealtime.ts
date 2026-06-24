import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, MetricKey } from '../core/contract'
import { getRuntime } from '../plugin/runtime'
import { kvCacheStore } from '../surfacing/cacheStore'

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
}

export interface ReadForWidgetRealtimeArgs {
	req: PayloadRequest
	metric: MetricKey
	windowMinutes: number
	adapterId?: string
	now: Date
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
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return empty('unavailable', adapterId ?? '')
	}
	let adapter: AnalyticsAdapter
	try {
		adapter = adapterId ? runtime.registry.get(adapterId) : runtime.registry.default()
	} catch {
		return empty('unavailable', adapterId ?? '')
	}
	if (!adapter.isConfigured()) {
		return empty('not-configured', adapter.id)
	}
	if (!adapter.realtime || !satisfiesCapabilities(adapter.capabilities, { realtime: true })) {
		return empty('unavailable', adapter.id)
	}

	const ttlSeconds = adapter.capabilities.recommendedTtl.realtime || runtime.ttl.realtime
	const bucket = Math.floor(now.getTime() / 1000 / Math.max(1, ttlSeconds))
	const key = `rt:${adapter.id}:${metric}:${windowMinutes}:${bucket}`
	const store = kvCacheStore(req.payload.kv)
	const cached = await store.get<WidgetRealtimeResult>(key)
	if (cached) {
		return cached
	}

	const dateRange = { start: new Date(now.getTime() - windowMinutes * 60_000), end: now }
	const result = await adapter.realtime({ metrics: [metric], dateRange }, {})
	const out: WidgetRealtimeResult = {
		status: 'ok',
		adapterId: adapter.id,
		activeNow: result.totals?.[metric] ?? 0,
		series: result.rows.map((r) => ({ date: r.timestamp ?? '', value: r.metrics[metric] ?? 0 })),
	}
	await store.set(key, out, ttlSeconds)
	return out
}
