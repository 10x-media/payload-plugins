import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsFilter,
	AnalyticsResult,
	DateRange,
	DimensionKey,
	MetricKey,
} from '../core/contract'
import { resolveReadContext } from '../core/scopedRead'
import { goalSlugsFor } from '../plugin/goalHint'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { supportsFilters, type WidgetReadStatus } from './readForWidget'

export interface BreakdownRow {
	label: string
	value: number
	/** Every metric the read asked for, present only when `extraMetrics` asked for more. */
	metrics?: Partial<Record<MetricKey, number>>
}

export interface WidgetBreakdownResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	rows: BreakdownRow[]
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	clamped?: boolean
	/** True when the engine served a stale cache entry after a failed provider read. */
	stale?: boolean
	/** True when the source answered without one of the filters the read carried. */
	filtersUnapplied?: boolean
	/** True when the source could not read the scope's goals; the rows say nothing about them. */
	goalsUnresolved?: boolean
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
	/**
	 * Reporting timezone the caller already resolved, reused rather than resolved again so
	 * a caller-supplied `range` is read in the very timezone it was interpreted in.
	 */
	timezone?: string
	filters?: AnalyticsFilter[]
	/**
	 * Further metrics to read alongside the ranked one, narrowed to what the source serves
	 * so an unsupported one never turns the whole read unavailable. They reach each row's
	 * `metrics`; ranking and status still follow `metric` alone.
	 */
	extraMetrics?: MetricKey[]
	/**
	 * The scope's goal slugs, for a `goal` or `conversions` read. Resolved here when omitted,
	 * so a caller that already resolved them (the goals table) does not resolve them twice.
	 */
	goalSlugs?: string[]
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
			dateRange: range ?? resolveTimeframe(timeframe, now, args.timezone),
			rows: emptyRows,
		}
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now, args.timezone),
			rows: emptyRows,
		}
	}
	const tz = args.timezone ?? (await resolveTimezoneFor(runtime, req, ctx.scope))
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
		})
	) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	if (!supportsFilters(adapter.capabilities, filters)) {
		return { status: 'filter-unsupported', adapterId: adapter.id, ...base }
	}
	const metrics = [
		metric,
		...(args.extraMetrics ?? []).filter((m) => m !== metric && adapter.capabilities.metrics.has(m)),
	]
	const goalSlugs =
		args.goalSlugs ??
		(await goalSlugsFor({ runtime, req, scope: ctx.scope, metrics, dimensions: [dimension] }))
	let result: AnalyticsResult
	try {
		result = await runtime.engine.read(adapter, {
			metrics,
			dimensions: [dimension],
			dateRange,
			limit,
			order: { metric, direction: 'desc' },
			filters,
			timezone: tz,
			scope: ctx.queryScope,
			...(goalSlugs === undefined ? {} : { goalSlugs }),
		})
	} catch {
		// No cache entry (fresh or stale) survived the failed read; degrade like an
		// unsupported capability instead of throwing through the widget render tree.
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const rows = result.rows.map((row) => ({
		label: row.dimensions?.[dimension] ?? '(none)',
		value: row.metrics[metric] ?? 0,
		...(metrics.length > 1 ? { metrics: row.metrics } : {}),
	}))
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		rows,
		provider: result.meta.provider,
		clamped: result.meta.clamped ?? false,
		stale: result.meta.stale ?? false,
		filtersUnapplied: (result.meta.unappliedFilters?.length ?? 0) > 0,
		goalsUnresolved: result.meta.goalsUnresolved === true,
	}
}
