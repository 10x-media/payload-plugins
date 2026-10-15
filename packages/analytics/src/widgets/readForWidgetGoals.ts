import type { PayloadRequest } from 'payload'
import { type ReadPrincipal, readPrincipalOf } from '../access/principal'
import type { DateRange } from '../core/contract'
import { type AnalyticsRuntime, goalNamesFor, resolveGoalsDetailedFor } from '../plugin/runtime'
import { MAX_QUERY_LIMIT } from '../query/limits'
import type { TimeframePreset } from '../timeframe/presets'
import { conversionRate } from '../view/conversionRate'
import {
	comparisonWindow,
	pinnedScope,
	prepareWidgetRead,
	type StoredSourceRead,
	type SubstitutedSource,
	substitutionOf,
	type WidgetReadStatus,
} from './prepareWidgetRead'
import { readForWidget } from './readForWidget'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'
import { mergeNotices, type ReadNotices } from './readMeta'

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

export interface WidgetGoalsResult extends Partial<ReadNotices>, SubstitutedSource {
	status: WidgetReadStatus
	/** How long until a `busy` read can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
	adapterId: string
	/**
	 * Scope a link to this read must name, set only when the viewer would not resolve it alone:
	 * a needless `scope` refuses every reader without `access.crossScope`.
	 */
	scope?: string
	dateRange: DateRange
	timezone: string
	rows: GoalRow[]
	/** Range total the rate divides by; absent when the source does not serve visitors. */
	siteVisitors?: number
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	/** True when the scope declares no goals of its own: an empty table, not a failure. */
	noGoals?: boolean
}

/** Scoped like `ReadForWidgetArgs`: the request's own scope unless one is pinned. */
export type ReadForWidgetGoalsArgs = ReadPrincipal &
	StoredSourceRead & {
		req: PayloadRequest
		timeframe: TimeframePreset
		limit: number
		/** Read the previous window too, when the source can compare. */
		compare: boolean
		adapterId?: string
		now: Date
		range?: DateRange
		/**
		 * Reporting timezone the caller already resolved, reused rather than resolved again so
		 * a caller-supplied `range` is read in the very timezone it was interpreted in.
		 */
		timezone?: string
	}

/**
 * How much wider than the table the previous window is read: each window ranks by its own
 * conversions, so a goal in today's top rows may rank too low there to keep its delta.
 */
const PREVIOUS_LIMIT_FACTOR = 4

const previousLimit = (limit: number): number =>
	Math.min(limit * PREVIOUS_LIMIT_FACTOR, MAX_QUERY_LIMIT)

/**
 * The scope's goal slugs and their display names. A throwing resolver must not cost the table:
 * rows fall back to slugs and `'unresolved'` tells the read apart from a scope with no goals.
 */
const goalNames = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<{ slugs: string[]; names: Map<string, string>; builtin: string[] } | 'unresolved'> => {
	try {
		const resolved = await resolveGoalsDetailedFor(runtime, req, scope)
		const shown = await goalNamesFor({ runtime, req, scope, resolved })
		return {
			slugs: resolved.map(({ goal }) => goal.slug),
			names: new Map(shown.map((goal) => [goal.slug, goal.name])),
			builtin: resolved.filter((entry) => entry.source === 'builtin').map(({ goal }) => goal.slug),
		}
	} catch (err) {
		req.payload.logger?.warn(`analytics: widget goal names failed to resolve: ${String(err)}`)
		return 'unresolved'
	}
}

/**
 * Goals table from a `goal` breakdown, a visitors total for the rate and, when comparing, the
 * previous window's breakdown. Status is the breakdown's: a table without rows shows nothing.
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
		...readPrincipalOf(args),
		...(args.fallbackWhenUnreadable ? { fallbackWhenUnreadable: true } : {}),
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
	const shared = { req, timeframe, adapterId: adapter.id, ...prepared.pin, timezone: tz, now }
	const comparisonRange = compare ? comparisonWindow(prepared, now) : undefined

	// The names are resolved first: their slugs are the hint a provider source restricts its
	// goal rows to, so both reads below need them before they run.
	const resolved = await goalNames(runtime, req, prepared.scope)
	const names = resolved === 'unresolved' ? new Map<string, string>() : resolved.names
	const builtinGoalSlugs = resolved === 'unresolved' ? [] : resolved.builtin
	const goalSlugs = resolved === 'unresolved' ? 'unresolved' : resolved.slugs
	const [breakdown, totals, previous] = await Promise.all([
		readForWidgetBreakdown({
			...shared,
			range: dateRange,
			metric: 'conversions',
			dimension: 'goal',
			limit,
			extraMetrics: ['revenue', 'visitors'],
			goalSlugs,
			builtinGoalSlugs,
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
					builtinGoalSlugs,
				})
			: undefined,
	])
	if (breakdown.status !== 'ok') {
		return {
			...fallback(breakdown.status, breakdown.adapterId, { dateRange, timezone: tz }),
			...(breakdown.retryAfterMs === undefined ? {} : { retryAfterMs: breakdown.retryAfterMs }),
		}
	}

	const previousBySlug = new Map(
		(previous?.status === 'ok' ? previous.rows : []).map((row) => [row.dimensionValue, row.value])
	)
	const visitorTotal = totals?.status === 'ok' ? totals.metrics.visitors : undefined
	const siteVisitors = typeof visitorTotal === 'number' ? visitorTotal : undefined
	const rows: GoalRow[] = breakdown.rows
		.map((row) => {
			const rate = conversionRate(row.metrics?.visitors, siteVisitors)
			const previousConversions = previousBySlug.get(row.dimensionValue)
			const revenue = row.metrics?.revenue
			return {
				slug: row.dimensionValue,
				name: names.get(row.dimensionValue) ?? row.dimensionValue,
				conversions: row.value ?? 0,
				...(typeof revenue === 'number' ? { revenue } : {}),
				...(rate !== null ? { rate } : {}),
				...(typeof previousConversions === 'number' ? { previousConversions } : {}),
			}
		})
		// The adapter ranks and caps already; re-applying both keeps one that does not from
		// spilling a long, unranked table into a dashboard card.
		.sort((a, b) => b.conversions - a.conversions)
		.slice(0, limit)

	return {
		status: 'ok',
		adapterId: adapter.id,
		...substitutionOf(prepared),
		// The caller's own scope, not the one this pinned onto its sub-reads: those are always
		// explicitly scoped, so reading their answer back would name every viewer's own scope.
		...pinnedScope(args, prepared.queryScope),
		dateRange,
		timezone: tz,
		rows,
		...(siteVisitors !== undefined ? { siteVisitors } : {}),
		...(breakdown.provider === undefined ? {} : { provider: breakdown.provider }),
		...mergeNotices(breakdown, totals, previous),
		goalsUnresolved: breakdown.goalsUnresolved === true,
		noGoals: breakdown.noGoals === true,
	}
}
