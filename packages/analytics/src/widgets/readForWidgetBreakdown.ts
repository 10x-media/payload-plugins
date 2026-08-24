import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsFilter,
	DateRange,
	DimensionKey,
	MetricKey,
} from '../core/contract'
import { resolveReadContext } from '../core/scopedRead'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import type { WidgetReadStatus } from './readForWidget'

export interface BreakdownRow {
	label: string
	value: number
}

export interface WidgetBreakdownResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	rows: BreakdownRow[]
	clamped?: boolean
}

export interface ReadForWidgetBreakdownArgs {
	req: PayloadRequest
	metric: MetricKey
	dimension: DimensionKey
	timeframe: TimeframePreset
	limit: number
	adapterId?: string
	now: Date
	range?: DateRange
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
	filters?: AnalyticsFilter[]
}

/**
 * Site-wide ranked breakdown of one metric by one dimension, read through the engine.
 * Mirrors `readForWidget` but gates on the dimension too and maps each result row to a
 * `{ label, value }` pair the bar list renders. The adapter owns sorting and limiting.
 */
export const readForWidgetBreakdown = async (
	args: ReadForWidgetBreakdownArgs
): Promise<WidgetBreakdownResult> => {
	const { req, metric, dimension, timeframe, limit, adapterId, now, range, filters } = args
	const emptyRows = [] as BreakdownRow[]

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now),
			rows: emptyRows,
		}
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now),
			rows: emptyRows,
		}
	}
	const tz = await resolveTimezoneFor(runtime, req, ctx.scope)
	const dateRange = range ?? resolveTimeframe(timeframe, now, tz)
	const base = { dateRange, rows: emptyRows }
	const adapter: AnalyticsAdapter = ctx.adapter
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, ...base }
	}
	if (
		!satisfiesCapabilities(adapter.capabilities, {
			metrics: [metric],
			dimensions: [dimension],
			...(filters && filters.length > 0 ? { filters: filters.map((f) => f.dimension) } : {}),
		})
	) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const result = await runtime.engine.read(adapter, {
		metrics: [metric],
		dimensions: [dimension],
		dateRange,
		limit,
		order: { metric, direction: 'desc' },
		filters,
		timezone: tz,
		scope: ctx.queryScope,
	})
	const rows = result.rows.map((row) => ({
		label: row.dimensions?.[dimension] ?? '(none)',
		value: row.metrics[metric] ?? 0,
	}))
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		rows,
		clamped: result.meta.clamped ?? false,
	}
}
