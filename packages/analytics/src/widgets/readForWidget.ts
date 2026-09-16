import type { PayloadRequest } from 'payload'
import { comparisonOf } from '../core/capabilities'
import type { AnalyticsFilter, AnalyticsResult, DateRange, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { previousWindow, withinLookback } from './comparison'
import { prepareWidgetRead, type WidgetReadStatus } from './prepareWidgetRead'
import { readMeta } from './readMeta'

export type { WidgetReadStatus } from './prepareWidgetRead'

export interface WidgetReadResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	metrics: Partial<Record<MetricKey, number>>
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	clamped?: boolean
	/** True when the engine served a stale cache entry after a failed provider read. */
	stale?: boolean
	/** True when the source answered without one of the filters the read carried. */
	filtersUnapplied?: boolean
	/** True when the read hit the source's event scan cap, so the numbers are a floor. */
	sampled?: boolean
	/** True when the source could not read the scope's goals, so a conversions total means nothing. */
	goalsUnresolved?: boolean
	/** The read asked about goals and the scope has none configured. */
	noGoals?: boolean
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

	const prepared = await prepareWidgetRead({
		req,
		now,
		timeframe,
		adapterId,
		scope: args.scope,
		timezone: args.timezone,
		range,
		filters,
		requires: { metrics },
		goalRead: () => ({ metrics }),
	})
	if (!prepared.ok) {
		return {
			status: prepared.status,
			adapterId: prepared.adapterId,
			dateRange: prepared.dateRange,
			metrics: emptyMetrics,
		}
	}
	const { runtime, adapter, tz, dateRange } = prepared
	const base = { dateRange, metrics: emptyMetrics }

	const previousRange =
		args.comparison !== false && runtime.comparison && comparisonOf(adapter.capabilities)
			? previousWindow(dateRange, tz)
			: null
	const comparisonRange =
		previousRange &&
		withinLookback(previousRange, adapter.capabilities.maxLookbackDays, { tz, now })
			? previousRange
			: undefined
	const readBase = {
		metrics,
		filters,
		timezone: tz,
		scope: prepared.queryScope,
		...(prepared.goalSlugs === undefined ? {} : { goalSlugs: prepared.goalSlugs }),
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
		...readMeta(result),
		noGoals: Array.isArray(prepared.goalSlugs) && prepared.goalSlugs.length === 0,
		previousMetrics,
		comparisonRange,
	}
}
