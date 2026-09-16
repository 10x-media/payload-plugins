import type { PayloadRequest } from 'payload'
import { comparisonOf } from '../core/capabilities'
import type { DateRange } from '../core/contract'
import { type AnalyticsRuntime, resolveGoalsDetailedFor } from '../plugin/runtime'
import { MAX_QUERY_LIMIT } from '../query/limits'
import type { TimeframePreset } from '../timeframe/presets'
import { conversionRate } from '../view/conversionRate'
import { previousWindow, withinLookback } from './comparison'
import { prepareWidgetRead, type WidgetReadStatus } from './prepareWidgetRead'
import { readForWidget } from './readForWidget'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'

export interface GoalRow {
	slug: string
	/** The goal's admin-facing name, or its slug when no configured goal claims it. */
	name: string
	conversions: number
	revenue?: number
	/** 0..1 share of the site's visitors, absent when either side of the ratio is missing. */
	rate?: number
	previousConversions?: number
}

export interface WidgetGoalsResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	timezone: string
	rows: GoalRow[]
	/** Range total the rate divides by; absent when the source does not serve visitors. */
	siteVisitors?: number
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	clamped?: boolean
	stale?: boolean
	/** True when the source answered without one of the filters a read carried. */
	filtersUnapplied?: boolean
	/** True when a read hit the source's event scan cap, so the numbers are a floor. */
	sampled?: boolean
	/** True when the source could not read the scope's goals, so the empty table means nothing. */
	goalsUnresolved?: boolean
	/** True when the scope configures no goals at all, which is an empty table, not a failure. */
	noGoals?: boolean
}

export interface ReadForWidgetGoalsArgs {
	req: PayloadRequest
	timeframe: TimeframePreset
	limit: number
	/** Read the previous window too, when the source can compare. */
	compare: boolean
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
}

/**
 * How much wider than the table the previous window is read. Both windows rank by their own
 * conversions, so a goal in today's top rows may sit well below them in the previous window;
 * reading only as many rows as the table shows would drop exactly those deltas. Capped at
 * the bound every analytics query is held to.
 */
const PREVIOUS_LIMIT_FACTOR = 4

const previousLimit = (limit: number): number =>
	Math.min(limit * PREVIOUS_LIMIT_FACTOR, MAX_QUERY_LIMIT)

/**
 * Goal names for the read's own scope. A resolver that throws must not cost the widget its
 * table, so the rows fall back to their slugs; the failure travels on as the hint, which is
 * what tells the read apart from a scope that configured no goals at all.
 */
const goalNames = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<Map<string, string> | 'unresolved'> => {
	try {
		const resolved = await resolveGoalsDetailedFor(runtime, req, scope)
		return new Map(resolved.map(({ goal }) => [goal.slug, goal.name]))
	} catch (err) {
		req.payload.logger?.warn(`analytics: widget goal names failed to resolve: ${String(err)}`)
		return 'unresolved'
	}
}

/**
 * The goals table behind the goals widget: conversions per goal over the window, each with
 * its revenue, its share of the site's visitors, and (when comparing) the same goal's
 * conversions in the previous window. Rows come from one `goal` breakdown read and the site
 * total from one totals read, both through the existing widget helpers so capability
 * gating, scoping and caching stay in one place. Revenue and visitors ride along only where
 * the source serves them; the status is the breakdown's, since a table without its rows has
 * nothing to show.
 */
export const readForWidgetGoals = async (
	args: ReadForWidgetGoalsArgs
): Promise<WidgetGoalsResult> => {
	const { req, timeframe, limit, compare, adapterId, now } = args
	const fallback = (
		status: WidgetReadStatus,
		id: string,
		window: { dateRange: DateRange; timezone: string }
	): WidgetGoalsResult => ({ status, adapterId: id, rows: [], ...window })

	const prepared = await prepareWidgetRead({
		req,
		now,
		timeframe,
		adapterId,
		scope: args.scope,
		timezone: args.timezone,
		range: args.range,
	})
	if (!prepared.ok) {
		return fallback(prepared.status, prepared.adapterId, {
			dateRange: prepared.dateRange,
			timezone: prepared.tz,
		})
	}
	const { runtime, adapter, tz, dateRange } = prepared
	// The sub-reads resolve their own context; pinning the adapter, scope, timezone and
	// window keeps all three answering about exactly the same read.
	const shared = { req, timeframe, adapterId: adapter.id, scope: prepared.scope, timezone: tz, now }
	const previousRange =
		compare && runtime.comparison && comparisonOf(adapter.capabilities)
			? previousWindow(dateRange, tz)
			: null
	const comparisonRange =
		previousRange &&
		withinLookback(previousRange, adapter.capabilities.maxLookbackDays, { tz, now })
			? previousRange
			: undefined

	// The names are resolved first: their slugs are the hint a provider source restricts its
	// goal rows to, so both reads below need them before they run.
	const resolved = await goalNames(runtime, req, prepared.scope)
	const names = resolved === 'unresolved' ? new Map<string, string>() : resolved
	const goalSlugs = resolved === 'unresolved' ? 'unresolved' : [...names.keys()]
	const [breakdown, totals, previous] = await Promise.all([
		readForWidgetBreakdown({
			...shared,
			range: dateRange,
			metric: 'conversions',
			dimension: 'goal',
			limit,
			extraMetrics: ['revenue', 'visitors'],
			goalSlugs,
		}),
		adapter.capabilities.metrics.has('visitors')
			? // The site total is a denominator, never a delta: its own previous window would
				// be a second read nothing renders.
				readForWidget({ ...shared, range: dateRange, metrics: ['visitors'], comparison: false })
			: undefined,
		comparisonRange
			? readForWidgetBreakdown({
					...shared,
					range: comparisonRange,
					metric: 'conversions',
					dimension: 'goal',
					limit: previousLimit(limit),
					goalSlugs,
				})
			: undefined,
	])
	if (breakdown.status !== 'ok') {
		return fallback(breakdown.status, breakdown.adapterId, { dateRange, timezone: tz })
	}

	const previousBySlug = new Map(
		(previous?.status === 'ok' ? previous.rows : []).map((row) => [row.label, row.value])
	)
	const siteVisitors = totals?.status === 'ok' ? totals.metrics.visitors : undefined
	const rows: GoalRow[] = breakdown.rows
		.map((row) => {
			const rate = conversionRate(row.metrics?.visitors, siteVisitors)
			const previousConversions = previousBySlug.get(row.label)
			return {
				slug: row.label,
				name: names.get(row.label) ?? row.label,
				conversions: row.value,
				...(row.metrics?.revenue !== undefined ? { revenue: row.metrics.revenue } : {}),
				...(rate !== null ? { rate } : {}),
				...(previousConversions !== undefined ? { previousConversions } : {}),
			}
		})
		// The adapter ranks and caps already; re-applying both keeps one that does not from
		// spilling a long, unranked table into a dashboard card.
		.sort((a, b) => b.conversions - a.conversions)
		.slice(0, limit)

	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		timezone: tz,
		rows,
		...(siteVisitors !== undefined ? { siteVisitors } : {}),
		...(breakdown.provider === undefined ? {} : { provider: breakdown.provider }),
		clamped: Boolean(breakdown.clamped || totals?.clamped || previous?.clamped),
		stale: Boolean(breakdown.stale || totals?.stale || previous?.stale),
		filtersUnapplied: Boolean(
			breakdown.filtersUnapplied || totals?.filtersUnapplied || previous?.filtersUnapplied
		),
		sampled: Boolean(breakdown.sampled || totals?.sampled || previous?.sampled),
		goalsUnresolved: breakdown.goalsUnresolved === true,
		noGoals: breakdown.noGoals === true,
	}
}
