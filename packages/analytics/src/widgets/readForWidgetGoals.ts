import type { PayloadRequest } from 'payload'
import { comparisonOf } from '../core/capabilities'
import type { DateRange } from '../core/contract'
import { resolveReadContext } from '../core/scopedRead'
import {
	type AnalyticsRuntime,
	getRuntime,
	resolveGoalsDetailedFor,
	resolveTimezoneFor,
} from '../plugin/runtime'
import { MAX_QUERY_LIMIT } from '../query/limits'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { conversionRate } from '../view/conversionRate'
import { previousWindow, withinLookback } from './comparison'
import { readForWidget, type WidgetReadStatus } from './readForWidget'
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
	clamped?: boolean
	stale?: boolean
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
 * table, so the rows fall back to their slugs.
 */
const goalNames = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<Map<string, string>> => {
	try {
		const resolved = await resolveGoalsDetailedFor(runtime, req, scope)
		return new Map(resolved.map(({ goal }) => [goal.slug, goal.name]))
	} catch (err) {
		req.payload.logger?.warn(`analytics: widget goal names failed to resolve: ${String(err)}`)
		return new Map()
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
	const fallback = (status: WidgetReadStatus, id: string): WidgetGoalsResult => ({
		status,
		adapterId: id,
		dateRange: args.range ?? resolveTimeframe(timeframe, now, args.timezone),
		timezone: args.timezone ?? DEFAULT_TIMEZONE,
		rows: [],
	})

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return fallback('unavailable', adapterId ?? '')
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return fallback('unavailable', adapterId ?? '')
	}
	const adapter = ctx.adapter
	const tz = args.timezone ?? (await resolveTimezoneFor(runtime, req, ctx.scope))
	const dateRange = args.range ?? resolveTimeframe(timeframe, now, tz)
	// The sub-reads resolve their own context; pinning the adapter, scope, timezone and
	// window keeps all three answering about exactly the same read.
	const shared = { req, timeframe, adapterId: adapter.id, scope: ctx.scope, timezone: tz, now }
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
	const names = await goalNames(runtime, req, ctx.scope)
	const goalSlugs = [...names.keys()]
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
		return { ...fallback(breakdown.status, breakdown.adapterId), dateRange, timezone: tz }
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
		clamped: Boolean(breakdown.clamped || totals?.clamped || previous?.clamped),
		stale: Boolean(breakdown.stale || totals?.stale || previous?.stale),
	}
}
