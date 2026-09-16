import type { AnalyticsQuery, AnalyticsResult } from '../core/contract'

/**
 * The goal slugs a provider read may restrict its rows to, or null when the caller set no
 * hint. Nothing in a provider marks which of its events are this install's goals, so a
 * provider adapter counts conversions for these names and for no others.
 */
export const goalHint = (q: AnalyticsQuery): string[] | null => {
	const slugs = [...new Set((q.goalSlugs ?? []).filter((slug) => slug.length > 0))]
	return slugs.length > 0 ? slugs : null
}

/** A `goal` breakdown a provider was asked for without the hint that defines its rows. */
export const goalsUnresolvedResult = (provider: string, q: AnalyticsQuery): AnalyticsResult => ({
	rows: [],
	meta: { provider, fetchedAt: q.dateRange.end.toISOString(), goalsUnresolved: true },
})
