import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf } from '../access/principal'
import type {
	AnalyticsFilter,
	AnalyticsResult,
	DateRange,
	MetricKey,
	MetricValues,
} from '../core/contract'
import { hasNoDeclaredGoals } from '../goals/latent'
import { readFailureOf } from '../surfacing/classifyError'
import type { TimeframePreset } from '../timeframe/presets'
import {
	comparisonWindow,
	engineRead,
	pinnedScope,
	prepareWidgetRead,
	type WidgetReadStatus,
} from './prepareWidgetRead'
import { type ReadNotices, readMeta } from './readMeta'

export type { WidgetReadStatus } from './prepareWidgetRead'

export interface WidgetReadResult extends Partial<ReadNotices> {
	status: WidgetReadStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	adapterId: string
	/** The reporting timezone the read resolved in, which names its days. */
	timezone?: string
	/**
	 * Scope a link to this read must name, set only when the viewer would not resolve it alone:
	 * a needless `scope` refuses every reader without `access.crossScope`.
	 */
	scope?: string
	dateRange: DateRange
	/** An average with nothing to average over reads `null`; render it as no data, not zero. */
	metrics: MetricValues
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	/** The read asked about goals and the scope declared none of its own. */
	noGoals?: boolean
	/** Previous-window totals, present only when the adapter supports comparison. */
	previousMetrics?: MetricValues
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
}

/**
 * Without `scope` the read is the request's own, behind `access.read`. A `scope` must be one
 * already cleared for this request, or a job's own with `principal: SYSTEM`.
 */
export type ReadForWidgetArgs = ReadPrincipal & {
	req: PayloadRequest
	metrics: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	now: Date
	range?: DateRange
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

/**
 * Totals of `metrics` over a widget's window, beside the previous window's where the install and
 * the source compare. A source that fails answers with a status rather than a throw.
 */
export const readForWidget = async (args: ReadForWidgetArgs): Promise<WidgetReadResult> => {
	const { req, metrics, timeframe, adapterId, now, range, filters } = args
	const prepared = await prepareWidgetRead({
		req,
		now,
		timeframe,
		adapterId,
		...readPrincipalOf(args),
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
			metrics: {},
		}
	}
	const { adapter, tz, dateRange } = prepared
	const comparisonRange = args.comparison === false ? undefined : comparisonWindow(prepared, now)
	const readBase = {
		metrics,
		filters,
		timezone: tz,
		scope: prepared.queryScope,
		...(prepared.goalSlugs === undefined ? {} : { goalSlugs: prepared.goalSlugs }),
	}
	const read = engineRead(prepared, timeframe)
	// The number first: a comparison that fails drops the delta, never the number itself.
	const main = read({ ...readBase, dateRange })
	const comparing = comparisonRange
		? read({ ...readBase, dateRange: comparisonRange }).catch(() => undefined)
		: undefined
	let result: AnalyticsResult
	try {
		result = await main
	} catch (err) {
		return { ...readFailureOf(err), adapterId: adapter.id, dateRange, metrics: {} }
	}
	const previous = await comparing
	const previousMetrics = previous ? (previous.totals ?? {}) : undefined
	return {
		status: 'ok',
		adapterId: adapter.id,
		...pinnedScope(args, prepared.queryScope),
		dateRange,
		timezone: tz,
		metrics: result.totals ?? {},
		...readMeta(result),
		noGoals:
			Array.isArray(prepared.goalSlugs) &&
			hasNoDeclaredGoals(prepared.goalSlugs, prepared.builtinGoalSlugs),
		previousMetrics,
		comparisonRange: previous ? comparisonRange : undefined,
	}
}
