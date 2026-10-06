import type { PayloadRequest } from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type {
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsFilter,
	DateRange,
	Granularity,
} from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { resolveReadContext } from '../core/scopedRead'
import { type GoalRead, goalSlugsFor } from '../plugin/goalHint'
import { type AnalyticsRuntime, getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'

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

interface PrepareWidgetReadBase {
	req: PayloadRequest
	now: Date
	adapterId?: string
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
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
	 * The read the goal hint is resolved for, answered once the adapter is known so a caller
	 * that narrows its metrics against the source hints on the list it will actually ask for.
	 * Omitted asks about no goals.
	 */
	goalRead?: (adapter: AnalyticsAdapter) => GoalRead
	/** A hint the caller already resolved, which wins over `goalRead`. */
	goalSlugs?: string[] | 'unresolved'
}

/** Either a preset to resolve the window from or the window itself. */
export type PrepareWidgetReadArgs = PrepareWidgetReadBase &
	({ timeframe: TimeframePreset; range?: DateRange } | { timeframe?: undefined; range: DateRange })

export type PreparedWidgetRead =
	| {
			ok: true
			runtime: AnalyticsRuntime
			adapter: AnalyticsAdapter
			/** Reporting timezone the window was resolved in. */
			tz: string
			dateRange: DateRange
			/** The read's own scope, which sub-reads pin so all of them answer about one thing. */
			scope: string | null
			/** The scope to stamp on the adapter query; undefined for install-wide reads. */
			queryScope?: string
			/** The scope's goal slugs, `'unresolved'`, or absent for a read about no goals. */
			goalSlugs?: string[] | 'unresolved'
	  }
	| {
			ok: false
			status: WidgetReadStatus
			adapterId: string
			dateRange: DateRange
			/** The timezone the window was read in: the resolved one, or the caller's own, or UTC. */
			tz: string
	  }

/**
 * The prologue every widget read shares: the runtime, the read's scope and adapter, the
 * reporting timezone, the window, and the gates a source has to pass before it is worth
 * querying. A refusal carries the status the widget renders and the window it would have
 * read, so a helper's own failure shape is one spread rather than five early returns.
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
		? await resolveReadContext({ runtime, req, adapterId: args.adapterId, scope: args.scope })
		: { ok: false as const }
	if (!runtime || !ctx.ok) {
		return {
			ok: false,
			status: 'unavailable',
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
	if (args.requires && !satisfiesCapabilities(adapter.capabilities, args.requires)) {
		return refuse('unavailable')
	}
	if (args.granularity && !supportsGranularity(adapter.capabilities, args.granularity)) {
		return refuse('unavailable')
	}
	if (!supportsFilters(adapter.capabilities, args.filters)) {
		return refuse('filter-unsupported')
	}

	const goalSlugs =
		args.goalSlugs ??
		(args.goalRead
			? await goalSlugsFor({ runtime, req, scope: ctx.scope, ...args.goalRead(adapter) })
			: undefined)
	return {
		ok: true,
		runtime,
		adapter,
		tz,
		dateRange,
		scope: ctx.scope,
		...(ctx.queryScope === undefined ? {} : { queryScope: ctx.queryScope }),
		...(goalSlugs === undefined ? {} : { goalSlugs }),
	}
}
