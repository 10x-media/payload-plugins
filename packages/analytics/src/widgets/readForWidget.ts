import type { PayloadRequest } from 'payload'
import { comparisonOf, satisfiesCapabilities } from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsFilter,
	AnalyticsResult,
	DateRange,
	MetricKey,
} from '../core/contract'
import { resolveReadContext } from '../core/scopedRead'
import { goalSlugsFor } from '../plugin/goalHint'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { previousWindow, withinLookback } from './comparison'

export type WidgetReadStatus = 'ok' | 'not-configured' | 'unavailable' | 'filter-unsupported'

/**
 * Whether the serving source can apply every filter the read carries. Answered before the
 * query so a source that cannot filter says so rather than returning site-wide numbers a
 * reader would take for filtered ones.
 */
export const supportsFilters = (
	caps: AnalyticsCapabilities,
	filters?: AnalyticsFilter[]
): boolean =>
	!filters ||
	filters.length === 0 ||
	satisfiesCapabilities(caps, {
		filters: filters.map((f) => f.dimension),
		filterOperators: filters.map((f) => f.operator),
	})

export interface WidgetReadResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	metrics: Partial<Record<MetricKey, number>>
	clamped?: boolean
	/** True when the engine served a stale cache entry after a failed provider read. */
	stale?: boolean
	/** True when the source answered without one of the filters the read carried. */
	filtersUnapplied?: boolean
	/** True when the read hit the source's event scan cap, so the numbers are a floor. */
	sampled?: boolean
	/** Previous-window totals, present only when the adapter supports comparison. */
	previousMetrics?: Partial<Record<MetricKey, number>>
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
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
	/**
	 * Reporting timezone the caller already resolved, reused rather than resolved again so
	 * a caller-supplied `range` is read in the very timezone it was interpreted in.
	 */
	timezone?: string
	filters?: AnalyticsFilter[]
	/**
	 * Read the previous window too, where the install and the source both allow it. Defaults
	 * to on; a caller that never renders a delta passes false to save the second read.
	 */
	comparison?: boolean
}

export const readForWidget = async (args: ReadForWidgetArgs): Promise<WidgetReadResult> => {
	const { req, metrics, timeframe, adapterId, now, range, filters } = args
	const emptyMetrics = {} as Partial<Record<MetricKey, number>>

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now, args.timezone),
			metrics: emptyMetrics,
		}
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange: range ?? resolveTimeframe(timeframe, now, args.timezone),
			metrics: emptyMetrics,
		}
	}
	const tz = args.timezone ?? (await resolveTimezoneFor(runtime, req, ctx.scope))
	const dateRange = range ?? resolveTimeframe(timeframe, now, tz)
	const base = { dateRange, metrics: emptyMetrics }
	const adapter: AnalyticsAdapter = ctx.adapter
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, ...base }
	}
	if (!satisfiesCapabilities(adapter.capabilities, { metrics })) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	if (!supportsFilters(adapter.capabilities, filters)) {
		return { status: 'filter-unsupported', adapterId: adapter.id, ...base }
	}
	const previousRange =
		args.comparison !== false && runtime.comparison && comparisonOf(adapter.capabilities)
			? previousWindow(dateRange, tz)
			: null
	const comparisonRange =
		previousRange &&
		withinLookback(previousRange, adapter.capabilities.maxLookbackDays, { tz, now })
			? previousRange
			: undefined
	const goalSlugs = await goalSlugsFor({ runtime, req, scope: ctx.scope, metrics })
	const readBase = {
		metrics,
		filters,
		timezone: tz,
		scope: ctx.queryScope,
		...(goalSlugs === undefined ? {} : { goalSlugs }),
	}
	let result: AnalyticsResult
	let previous: AnalyticsResult | undefined
	try {
		;[result, previous] = await Promise.all([
			runtime.engine.read(adapter, { ...readBase, dateRange }),
			comparisonRange
				? runtime.engine.read(adapter, { ...readBase, dateRange: comparisonRange })
				: undefined,
		])
	} catch {
		// No cache entry (fresh or stale) survived the failed read; degrade like an
		// unsupported capability instead of throwing through the widget render tree.
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const previousMetrics = previous ? (previous.totals ?? {}) : undefined
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		metrics: result.totals ?? {},
		clamped: result.meta.clamped ?? false,
		stale: result.meta.stale ?? false,
		filtersUnapplied: (result.meta.unappliedFilters?.length ?? 0) > 0,
		sampled: result.meta.sampled ?? false,
		previousMetrics,
		comparisonRange,
	}
}
