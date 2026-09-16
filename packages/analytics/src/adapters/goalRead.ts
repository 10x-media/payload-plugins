import type { AnalyticsQuery, AnalyticsResult, MetricKey } from '../core/contract'

/**
 * The goal slugs a provider read may restrict its rows to, or null when the caller set no
 * hint. Nothing in a provider marks which of its events are this install's goals, so a
 * provider adapter counts conversions for these names and for no others.
 */
export const goalHint = (q: AnalyticsQuery): string[] | null => {
	const slugs = [...new Set((q.goalSlugs ?? []).filter((slug) => slug.length > 0))]
	return slugs.length > 0 ? slugs : null
}

/** Meta a goal read still has to report beside its empty rows (unapplied filters, sampling). */
type GoalsUnresolvedMeta = Omit<
	AnalyticsResult['meta'],
	'provider' | 'fetchedAt' | 'goalsUnresolved'
>

/** A `goal` breakdown a provider was asked for without the hint that defines its rows. */
export const goalsUnresolvedResult = (
	provider: string,
	q: AnalyticsQuery,
	meta?: GoalsUnresolvedMeta
): AnalyticsResult => ({
	rows: [],
	meta: {
		provider,
		fetchedAt: q.dateRange.end.toISOString(),
		...meta,
		goalsUnresolved: true,
	},
})

export interface GoalMetricSplit {
	/** Metrics the plain request asks for. */
	siteMetrics: MetricKey[]
	/** Metrics only the goal-filtered request can answer; empty when the read has no hint. */
	goalMetrics: MetricKey[]
	/** The read wanted goal numbers it had no hint to ask for. */
	unresolved: boolean
}

/**
 * How a provider that serves goal metrics only under a goal filter splits one read in two.
 * A goal breakdown restricts every row it returns, so its single request carries everything;
 * anywhere else the goal metrics need a request of their own, because filtering the whole
 * read would scope the site metrics to goal hits as well.
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
	hint: string[] | null
}): GoalMetricSplit => {
	if (goalBreakdown) {
		return { siteMetrics: wanted, goalMetrics: [], unresolved: false }
	}
	const goalMetrics = wanted.filter((m) => goalOnly.has(m))
	const unresolved = goalMetrics.length > 0 && hint === null
	return {
		siteMetrics: wanted.filter((m) => !goalOnly.has(m)),
		goalMetrics: unresolved ? [] : goalMetrics,
		unresolved,
	}
}

/**
 * Provider metric names for a contract metric list, deduped: several contract metrics can
 * alias one provider metric (sessions and visits both map to Plausible's `visits`), so each
 * is read back from its provider key's position rather than from the request index.
 */
export const providerMetricKeys = (
	metrics: MetricKey[],
	map: Partial<Record<MetricKey, string>>
): string[] => [...new Set(metrics.map((m) => map[m] as string))]

export interface GoalKeyedRow {
	/** The row's dimension values in the request's dimension order; empty for a totals row. */
	keys: string[]
	metrics: Partial<Record<MetricKey, number>>
}

/**
 * The two halves of a pair read unioned by dimension key. A row only the site request
 * returned keeps its conversions absent (no goal fired there); a row only the goal request
 * returned is appended carrying its goal metrics alone, since the site request answers a
 * different ranking and its own limit may have cut the row off.
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
		return { keys: row.keys, metrics: { ...row.metrics, ...goalRow.metrics } }
	})
	return [...merged, ...byKey.values()]
}

/** The same union over a pair's totals rows, which carry no dimensions to key on. */
export const mergeGoalTotals = (
	site: Partial<Record<MetricKey, number>> | undefined,
	goals: Partial<Record<MetricKey, number>> | undefined
): Partial<Record<MetricKey, number>> | undefined =>
	site || goals ? { ...site, ...goals } : undefined

export interface GoalPair<Response> {
	site: Response | undefined
	goals: Response | undefined
	/** The goal request failed, so the read is served without its goal numbers. */
	failed: boolean
}

/**
 * One request shape issued twice, plainly and goal-filtered. Sequential rather than
 * concurrent: the engine takes a single limiter permit per `adapter.query`, so a parallel
 * pair would exceed the provider's declared concurrency. A goal request the provider rejects
 * (a property with no key events, a site with no revenue goals) costs the read its
 * conversions rather than all of it, unless there is no site half left to serve.
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
