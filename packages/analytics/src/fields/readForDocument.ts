import type { PayloadRequest } from 'payload'
import { resolveHostname, resolvePathCached } from '../binding/resolvePath'
import type { BindingDoc } from '../binding/types'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, DateRange, MetricKey } from '../core/contract'
import { resolveReadContext } from '../core/scopedRead'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'

export type FieldReadStatus = 'ok' | 'no-path' | 'not-bound' | 'not-configured' | 'unavailable'

export interface FieldReadResult {
	status: FieldReadStatus
	adapterId: string
	dateRange: DateRange
	metrics: Partial<Record<MetricKey, number>>
	/** Requested metrics the adapter supports, in request order; the set actually read. */
	supportedMetrics: MetricKey[]
	/** Requested metrics the adapter cannot serve, dropped from the read. */
	droppedMetrics: MetricKey[]
}

export interface ReadForFieldArgs {
	req: PayloadRequest
	collectionSlug: string
	data: BindingDoc
	metrics: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	now: Date
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
}

/**
 * Resolve a document's analytics for one display field: look up the runtime, resolve
 * the bound path, capability-gate the requested metrics against the active adapter,
 * then read through the surfacing engine. Returns a discriminated status so the
 * rendering component can show the right empty state without throwing.
 *
 * A metric the adapter does not support is dropped (with one warning per field
 * render), not fatal; `unavailable` is returned only when no requested metric
 * survives or the adapter cannot query per page at all.
 */
export const readForField = async (args: ReadForFieldArgs): Promise<FieldReadResult> => {
	const { req, collectionSlug, data, metrics, timeframe, adapterId, now } = args
	let dateRange = resolveTimeframe(timeframe, now)
	const empty = { metrics: {}, supportedMetrics: [], droppedMetrics: [] }
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return { status: 'not-bound', adapterId: adapterId ?? '', dateRange, ...empty }
	}
	const binding = runtime.bindings[collectionSlug]
	if (!binding) {
		return { status: 'not-bound', adapterId: adapterId ?? '', dateRange, ...empty }
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return { status: 'unavailable', adapterId: adapterId ?? '', dateRange, ...empty }
	}
	const tz = await resolveTimezoneFor(runtime, req, ctx.scope)
	dateRange = resolveTimeframe(timeframe, now, tz)
	const adapter: AnalyticsAdapter = ctx.adapter
	const bindingCtx = { req, locale: req.locale ?? undefined }
	let path: string | null
	try {
		path = await resolvePathCached(binding, data, bindingCtx)
	} catch {
		path = null
	}
	if (!path) {
		return { status: 'no-path', adapterId: adapter.id, dateRange, ...empty }
	}
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, dateRange, ...empty }
	}
	const supportedMetrics = metrics.filter((m) => adapter.capabilities.metrics.has(m))
	const droppedMetrics = metrics.filter((m) => !adapter.capabilities.metrics.has(m))
	if (droppedMetrics.length > 0) {
		req.payload.logger.warn(
			`analytics: adapter "${adapter.id}" does not support metric(s) ${droppedMetrics.join(', ')}; dropped from the "${collectionSlug}" display field`
		)
	}
	if (
		supportedMetrics.length === 0 ||
		!satisfiesCapabilities(adapter.capabilities, { metrics: supportedMetrics, perPageQuery: true })
	) {
		return {
			status: 'unavailable',
			adapterId: adapter.id,
			dateRange,
			metrics: {},
			supportedMetrics: [],
			droppedMetrics: metrics,
		}
	}
	const result = await runtime.engine.read(adapter, {
		path,
		hostname: await resolveHostname(binding, data, bindingCtx),
		metrics: supportedMetrics,
		dateRange,
		timezone: tz,
		scope: ctx.queryScope,
	})
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		metrics: result.totals ?? {},
		supportedMetrics,
		droppedMetrics,
	}
}
