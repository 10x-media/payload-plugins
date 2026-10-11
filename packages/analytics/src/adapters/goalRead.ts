import type { AnalyticsQuery, AnalyticsResult, MetricKey, MetricValues } from '../core/contract'

/**
 * The goal slugs a read restricts goal rows to, `'unresolved'` when the resolver failed, or null for
 * no hint. Providers cannot tell goals from events, so they count only the hinted names.
 */
export type GoalHint = { slugs: string[] } | 'unresolved' | null

export const goalHint = (q: AnalyticsQuery): GoalHint => {
	if (q.goalSlugs === undefined) {
		return null
	}
	if (q.goalSlugs === 'unresolved') {
		return 'unresolved'
	}
	return { slugs: [...new Set(q.goalSlugs.filter((slug) => slug.length > 0))] }
}

/** The slugs a provider request filters by, or null when the hint names none to filter by. */
export const hintSlugs = (hint: GoalHint): string[] | null =>
	hint === null || hint === 'unresolved' || hint.slugs.length === 0 ? null : hint.slugs

/**
 * Whether goal numbers are missing because the hint failed or was never set, rather than
 * because the install configured no goals, which is an empty result and not a failure.
 */
export const hintFailed = (hint: GoalHint): boolean => hint === null || hint === 'unresolved'

/** Meta a goal read still has to report beside its empty rows (unapplied filters, sampling). */
type GoalsUnresolvedMeta = Omit<
	AnalyticsResult['meta'],
	'provider' | 'fetchedAt' | 'goalsUnresolved'
>

/** A `goal` breakdown a provider was asked for without the hint that defines its rows. */
export const goalsUnresolvedResult = (
	provider: string,
	fetchedAt: string,
	meta?: GoalsUnresolvedMeta
): AnalyticsResult => ({
	rows: [],
	meta: {
		provider,
		fetchedAt,
		...meta,
		goalsUnresolved: true,
	},
})

/**
 * The answer a `goal` breakdown owes before reading, or null when its hint names rows. A failed or
 * absent hint sets `goalsUnresolved`; an install with no goals gets the same empty rows unflagged.
 */
export const emptyGoalBreakdown = ({
	provider,
	fetchedAt,
	hint,
	meta,
}: {
	provider: string
	/** When the read began, which the empty answer is stamped with. */
	fetchedAt: string
	hint: GoalHint
	meta?: GoalsUnresolvedMeta
}): AnalyticsResult | null => {
	if (hintSlugs(hint) !== null) {
		return null
	}
	return hintFailed(hint)
		? goalsUnresolvedResult(provider, fetchedAt, meta)
		: { rows: [], meta: { provider, fetchedAt, ...meta } }
}

export interface GoalMetricSplit {
	/** Metrics the plain request asks for. */
	siteMetrics: MetricKey[]
	/** Metrics only the goal-filtered request can answer; empty when the hint names no goal. */
	goalMetrics: MetricKey[]
	/** The read wanted goal numbers it had no hint to ask for. */
	unresolved: boolean
}

/**
 * How a provider that serves goal metrics only under a goal filter splits a read: a goal breakdown
 * is one request, anything else needs a second so site metrics are not scoped to goal hits.
 */
export const splitGoalMetrics = ({
	wanted,
	goalOnly,
	goalBreakdown,
	hint,
}: {
	wanted: MetricKey[]
	goalOnly: ReadonlySet<MetricKey>
	goalBreakdown: boolean
	hint: GoalHint
}): GoalMetricSplit => {
	if (goalBreakdown) {
		return { siteMetrics: wanted, goalMetrics: [], unresolved: false }
	}
	const goalMetrics = wanted.filter((m) => goalOnly.has(m))
	return {
		siteMetrics: wanted.filter((m) => !goalOnly.has(m)),
		goalMetrics: hintSlugs(hint) === null ? [] : goalMetrics,
		unresolved: goalMetrics.length > 0 && hintFailed(hint),
	}
}

export interface GoalKeyedRow {
	/** The row's dimension values in the request's dimension order; empty for a totals row. */
	keys: string[]
	metrics: MetricValues
	/** What the row's averages were taken over, as `AnalyticsRow.samples`. */
	samples?: Partial<Record<MetricKey, number>>
}

/**
 * A pair read unioned by dimension key. A site-only row has no conversions; a goal-only row is kept
 * with its goal metrics alone, since the site request's own limit may have cut it.
 */
export const mergeGoalRows = (
	site: GoalKeyedRow[] | undefined,
	goals: GoalKeyedRow[] | undefined
): GoalKeyedRow[] => {
	if (!site) {
		return goals ?? []
	}
	if (!goals) {
		return site
	}
	const byKey = new Map(goals.map((row) => [JSON.stringify(row.keys), row]))
	const merged = site.map((row) => {
		const key = JSON.stringify(row.keys)
		const goalRow = byKey.get(key)
		if (!goalRow) {
			return row
		}
		byKey.delete(key)
		return { ...row, metrics: { ...row.metrics, ...goalRow.metrics } }
	})
	return [...merged, ...byKey.values()]
}

/** The same union over a pair's totals rows, which carry no dimensions to key on. */
export const mergeGoalTotals = (
	site: MetricValues | undefined,
	goals: MetricValues | undefined
): MetricValues | undefined => (site || goals ? { ...site, ...goals } : undefined)

export interface GoalPair<Response> {
	site: Response | undefined
	goals: Response | undefined
	/** The goal request failed, so the read is served without its goal numbers. */
	failed: boolean
}

/**
 * One request shape issued plainly then goal-filtered, sequentially to stay within the engine's one
 * limiter permit. A rejected goal request costs only the conversions while a site half remains.
 */
export const readGoalPair = async <Response>({
	site,
	goals,
}: {
	site: (() => Promise<Response>) | undefined
	goals: (() => Promise<Response>) | undefined
}): Promise<GoalPair<Response>> => {
	const siteResponse = site ? await site() : undefined
	if (!goals) {
		return { site: siteResponse, goals: undefined, failed: false }
	}
	try {
		return { site: siteResponse, goals: await goals(), failed: false }
	} catch (error) {
		if (!site) {
			throw error
		}
		return { site: siteResponse, goals: undefined, failed: true }
	}
}
