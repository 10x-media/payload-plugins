import type { PayloadRequest } from 'payload'
import { resolveHostname, resolvePath } from '../binding/resolvePath'
import type { BindingDoc } from '../binding/types'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, DateRange, MetricKey } from '../core/contract'
import { getRuntime } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'

export type FieldReadStatus = 'ok' | 'no-path' | 'not-bound' | 'not-configured' | 'unavailable'

export interface FieldReadResult {
	status: FieldReadStatus
	adapterId: string
	dateRange: DateRange
	metrics: Partial<Record<MetricKey, number>>
}

export interface ReadForFieldArgs {
	req: PayloadRequest
	collectionSlug: string
	data: BindingDoc
	metrics: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	now: Date
}

/**
 * Resolve a document's analytics for one display field: look up the runtime, resolve
 * the bound path, capability-gate the requested metrics against the active adapter,
 * then read through the surfacing engine. Returns a discriminated status so the
 * rendering component can show the right empty state without throwing.
 */
export const readForField = async (args: ReadForFieldArgs): Promise<FieldReadResult> => {
	const { req, collectionSlug, data, metrics, timeframe, adapterId, now } = args
	const dateRange = resolveTimeframe(timeframe, now)
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return { status: 'not-bound', adapterId: adapterId ?? '', dateRange, metrics: {} }
	}
	const binding = runtime.bindings[collectionSlug]
	if (!binding) {
		return { status: 'not-bound', adapterId: adapterId ?? '', dateRange, metrics: {} }
	}
	let adapter: AnalyticsAdapter
	try {
		adapter = adapterId ? runtime.registry.get(adapterId) : runtime.registry.default()
	} catch {
		return { status: 'unavailable', adapterId: adapterId ?? '', dateRange, metrics: {} }
	}
	const path = resolvePath(binding, data, { req, locale: req.locale ?? undefined })
	if (!path) {
		return { status: 'no-path', adapterId: adapter.id, dateRange, metrics: {} }
	}
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, dateRange, metrics: {} }
	}
	if (!satisfiesCapabilities(adapter.capabilities, { metrics, perPageQuery: true })) {
		return { status: 'unavailable', adapterId: adapter.id, dateRange, metrics: {} }
	}
	const result = await runtime.engine.read(adapter, {
		path,
		hostname: resolveHostname(binding, data),
		metrics,
		dateRange,
	})
	return { status: 'ok', adapterId: adapter.id, dateRange, metrics: result.totals ?? {} }
}
