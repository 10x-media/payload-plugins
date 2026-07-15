import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, DateRange, MetricKey } from '../core/contract'
import { resolveReadContext } from '../core/scopedRead'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'

export type WidgetReadStatus = 'ok' | 'not-configured' | 'unavailable'

export interface WidgetReadResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	metrics: Partial<Record<MetricKey, number>>
	clamped?: boolean
}

export interface ReadForWidgetArgs {
	req: PayloadRequest
	metrics: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	now: Date
	range?: DateRange
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
}

export const readForWidget = async (args: ReadForWidgetArgs): Promise<WidgetReadResult> => {
	const { req, metrics, timeframe, adapterId, now, range } = args
	const emptyMetrics = {} as Partial<Record<MetricKey, number>>

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now),
			metrics: emptyMetrics,
		}
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now),
			metrics: emptyMetrics,
		}
	}
	const tz = await resolveTimezoneFor(runtime, req, ctx.scope)
	const dateRange = range ?? resolveTimeframe(timeframe, now, tz)
	const base = { dateRange, metrics: emptyMetrics }
	const adapter: AnalyticsAdapter = ctx.adapter
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, ...base }
	}
	if (!satisfiesCapabilities(adapter.capabilities, { metrics })) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const result = await runtime.engine.read(adapter, {
		metrics,
		dateRange,
		timezone: tz,
		scope: ctx.queryScope,
	})
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		metrics: result.totals ?? {},
		clamped: result.meta.clamped ?? false,
	}
}
