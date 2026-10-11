import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf } from '../access/principal'
import {
	type CapabilityRequirement,
	comparisonOf,
	filterOperatorsFor,
	satisfiesCapabilities,
	unsupportedFilter,
} from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	DateRange,
	Granularity,
} from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { readAsAsked, servedName } from '../core/metricAliases'
import { resolveReadContext } from '../core/scopedRead'
import { type GoalRead, goalHintFor } from '../plugin/goalHint'
import { type AnalyticsRuntime, getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { exceedsRangeCap } from '../query/limits'
import { previousWindow, withinLookback } from '../timeframe/comparison'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'

/**
 * `unavailable` is a source that cannot serve the read at all, `busy` one that failed for now
 * (a retry can fix it), `invalid` a read refused as asked, `range-too-long` over the query cap.
 */
export type WidgetReadStatus =
	| 'ok'
	| 'not-configured'
	| 'unavailable'
	| 'busy'
	| 'invalid'
	| 'range-too-long'
	| 'filter-unsupported'
	| 'no-access'
	| 'no-scope'
	| 'misconfigured'
	| 'host-refused'

/**
 * Whether the serving source can apply every filter, asked before the query so a source that
 * cannot filter says so rather than returning site-wide numbers that pass for filtered ones.
 */
const supportsFilters = (caps: AnalyticsCapabilities, filters?: AnalyticsFilter[]): boolean =>
	!filters || unsupportedFilter(caps, filters) === undefined

interface PrepareWidgetReadBase {
	req: PayloadRequest
	now: Date
	adapterId?: string
	/**
	 * Reporting timezone the caller already resolved, reused rather than resolved again so
	 * a caller-supplied `range` is read in the very timezone it was interpreted in.
	 */
	timezone?: string
	filters?: AnalyticsFilter[]
	/** What the source must serve for the read to be worth making. */
	requires?: CapabilityRequirement
	/** The finest bucket the read needs, gated against the source's `minGranularity`. */
	granularity?: Granularity
	/**
	 * Goal hint read, resolved once the adapter is known so a caller narrowing metrics against the
	 * source hints on the list it will ask for. Omitted asks about no goals.
	 */
	goalRead?: (adapter: AnalyticsAdapter) => GoalRead
	/** A hint the caller already resolved, which wins over `goalRead`. */
	goalSlugs?: string[] | 'unresolved'
	/** The latent built-in slugs behind that hint; read together with `goalSlugs`. */
	builtinGoalSlugs?: string[]
}

/**
 * A preset or the window itself. Without `scope` the read is the request's own; a `scope` must
 * be already cleared for this request, or be a job's own with `principal: SYSTEM`.
 */
export type PrepareWidgetReadArgs = PrepareWidgetReadBase &
	ReadPrincipal &
	({ timeframe: TimeframePreset; range?: DateRange } | { timeframe?: undefined; range: DateRange })

export type PreparedWidgetRead =
	| {
			ok: true
			runtime: AnalyticsRuntime
			adapter: AnalyticsAdapter
			/** Reporting timezone the window was resolved in. */
			tz: string
			dateRange: DateRange
			/** The read's own scope, null for install-wide and aggregate reads. */
			scope: string | null
			/** Principal and scope that sub-reads pin so all of them answer about one thing. */
			pin: ReadPrincipal
			/** The scope to stamp on the adapter query; undefined for install-wide reads. */
			queryScope?: string
			/** The scope's goal slugs, `'unresolved'`, or absent for a read about no goals. */
			goalSlugs?: string[] | 'unresolved'
			/**
			 * Slugs among them the install never declared: the latent built-in goal. A report
			 * lists one only once it has conversions, and never counts it as having goals.
			 */
			builtinGoalSlugs: string[]
			/** The resolved goals' names, when this read resolved the goals itself. */
			goalNames: Array<{ slug: string; name: string }>
	  }
	| {
			ok: false
			status: WidgetReadStatus
			adapterId: string
			dateRange: DateRange
			/** The timezone the window was read in: the resolved one, or the caller's own, or UTC. */
			tz: string
	  }

type PreparedSource = Pick<
	Extract<PreparedWidgetRead, { ok: true }>,
	'runtime' | 'adapter' | 'tz' | 'dateRange'
>

/** The engine read of a prepared source, each metric asked under the name the source serves. */
export const engineRead =
	({ runtime, adapter }: Pick<PreparedSource, 'runtime' | 'adapter'>, timeframe: TimeframePreset) =>
	(query: AnalyticsQuery): Promise<AnalyticsResult> =>
		readAsAsked(
			(served) => runtime.engine.read(adapter, served, { timeframe }),
			query,
			adapter.capabilities.metrics
		)

/**
 * The `scope` a result names for a link to it, only on a read the caller scoped itself: a needless
 * one refuses every reader without `access.crossScope`.
 */
export const pinnedScope = (
	args: ReadPrincipal,
	queryScope: string | undefined
): { scope?: string } =>
	args.scope === undefined || queryScope === undefined ? {} : { scope: queryScope }

/**
 * The previous window a read compares against: only when the install and the source both compare
 * and the source still keeps data that far back.
 */
export const comparisonWindow = (read: PreparedSource, now: Date): DateRange | undefined => {
	const { runtime, adapter, tz } = read
	if (!runtime.comparison || !comparisonOf(adapter.capabilities)) {
		return undefined
	}
	const previous = previousWindow(read.dateRange, tz)
	return previous && withinLookback(previous, adapter.capabilities.maxLookbackDays, { tz, now })
		? previous
		: undefined
}

/**
 * Prologue every widget read shares: runtime, scope, adapter, timezone, window and capability
 * gates. A refusal carries the widget's status and window, so a helper's failure is one spread.
 */
export const prepareWidgetRead = async (
	args: PrepareWidgetReadArgs
): Promise<PreparedWidgetRead> => {
	const { req, now } = args
	const windowIn = (zone?: string): DateRange =>
		args.timeframe === undefined
			? args.range
			: (args.range ?? resolveTimeframe(args.timeframe, now, zone))

	const runtime = getRuntime(req.payload)
	const ctx = runtime
		? await resolveReadContext({
				runtime,
				req,
				adapterId: args.adapterId,
				...readPrincipalOf(args),
			})
		: { ok: false as const }
	if (!runtime || !ctx.ok) {
		const reason = ctx.ok ? undefined : ctx.reason
		const status: WidgetReadStatus =
			reason === 'no-access' || reason === 'not-member'
				? 'no-access'
				: reason === 'no-scope'
					? 'no-scope'
					: 'unavailable'
		return {
			ok: false,
			status,
			adapterId: args.adapterId ?? '',
			dateRange: windowIn(args.timezone),
			tz: args.timezone ?? DEFAULT_TIMEZONE,
		}
	}

	const tz = args.timezone ?? (await resolveTimezoneFor(runtime, req, ctx.scope))
	const dateRange = windowIn(tz)
	const adapter = ctx.adapter
	const refuse = (status: WidgetReadStatus): PreparedWidgetRead => ({
		ok: false,
		status,
		adapterId: adapter.id,
		dateRange,
		tz,
	})
	if (!adapter.isConfigured()) {
		return refuse('not-configured')
	}
	if (args.range && exceedsRangeCap(args.range)) {
		return refuse('range-too-long')
	}
	// The widget's own filters count toward where its metric reads (a page filter for a metric
	// read only per page); one the source cannot apply at all is the filter check's to report.
	const filteredBy = (args.filters ?? [])
		.map((filter) => filter.dimension)
		.filter((dimension) => filterOperatorsFor(adapter.capabilities, dimension).length > 0)
	// A metric served under another name (`visits` as `sessions`) is read under that one.
	const metrics = args.requires?.metrics?.map((m) => servedName(m, adapter.capabilities.metrics))
	if (
		args.requires &&
		!satisfiesCapabilities(adapter.capabilities, {
			...args.requires,
			...(metrics ? { metrics } : {}),
			filters: [...(args.requires.filters ?? []), ...filteredBy],
		})
	) {
		return refuse('unavailable')
	}
	if (args.granularity && !supportsGranularity(adapter.capabilities, args.granularity)) {
		return refuse('unavailable')
	}
	if (!supportsFilters(adapter.capabilities, args.filters)) {
		return refuse('filter-unsupported')
	}

	const resolved =
		args.goalSlugs === undefined && args.goalRead
			? await goalHintFor({ runtime, req, scope: ctx.scope, ...args.goalRead(adapter) })
			: undefined
	const goalSlugs = args.goalSlugs ?? resolved?.slugs
	return {
		ok: true,
		runtime,
		adapter,
		tz,
		dateRange,
		scope: ctx.scope,
		pin: ctx.pin,
		builtinGoalSlugs: args.builtinGoalSlugs ?? resolved?.builtin ?? [],
		goalNames: resolved?.names ?? [],
		...(ctx.queryScope === undefined ? {} : { queryScope: ctx.queryScope }),
		...(goalSlugs === undefined ? {} : { goalSlugs }),
	}
}
