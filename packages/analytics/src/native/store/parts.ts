import type { MetricKey, MetricValue, MetricValues } from '../../core/contract'

/**
 * Additive counters behind every metric: averages are stored as numerator and denominator, so a
 * week is exact. `null`: the row's kind does not count that part at all, unlike counting none.
 */
export interface MetricParts {
	pageviews: number | null
	/** Events and goal completions. */
	events: number | null
	/** Distinct visitors of the row's own day: summed over days, a person counts once per day. */
	visitors: number | null
	sessions: number | null
	/** Sessions that started on the row: the bounce rate's denominator. */
	entries: number | null
	/** Entries whose session had one pageview and no event or goal. */
	bounces: number | null
	/** Engaged milliseconds of the sessions in `sessions`. */
	sessionMs: number | null
	/** Engaged milliseconds of the pageviews in `pageviews`. */
	durationMs: number | null
	/** Scroll depth summed over the pageviews that measured it. */
	scrollSum: number | null
	/** Pageviews that measured their scroll depth. */
	scrollSamples: number | null
	conversions: number | null
	revenue: number | null
	impressions: number | null
	interactions: number | null
}

export const PART_KEYS: ReadonlyArray<keyof MetricParts> = [
	'pageviews',
	'events',
	'visitors',
	'sessions',
	'entries',
	'bounces',
	'sessionMs',
	'durationMs',
	'scrollSum',
	'scrollSamples',
	'conversions',
	'revenue',
	'impressions',
	'interactions',
]

/** Nothing counted, the identity of {@link addParts}. */
export const emptyParts = (): MetricParts => ({
	pageviews: null,
	events: null,
	visitors: null,
	sessions: null,
	entries: null,
	bounces: null,
	sessionMs: null,
	durationMs: null,
	scrollSum: null,
	scrollSamples: null,
	conversions: null,
	revenue: null,
	impressions: null,
	interactions: null,
})

/** One part of two rows together: a count with nothing beside it stays that count. */
export const addPart = (a: number | null, b: number | null): number | null => {
	if (a === null) {
		return b
	}
	return b === null ? a : a + b
}

export const addParts = (a: MetricParts, b: MetricParts): MetricParts => {
	const sum = emptyParts()
	for (const key of PART_KEYS) {
		sum[key] = addPart(a[key], b[key])
	}
	return sum
}

export const sumParts = (all: Iterable<MetricParts>): MetricParts => {
	const sum = emptyParts()
	for (const parts of all) {
		for (const key of PART_KEYS) {
			sum[key] = addPart(sum[key], parts[key])
		}
	}
	return sum
}

/**
 * One part over another: absent when the row's kind does not count the denominator, `null` when
 * it counted none of it (nothing to average over), else rounded.
 */
const ratio = (
	numerator: number | null,
	denominator: number | null,
	scale = 1
): MetricValue | undefined => {
	if (denominator === null) {
		return undefined
	}
	if (denominator <= 0 || numerator === null) {
		return null
	}
	return Math.round((numerator / denominator) * scale)
}

const count = (part: number | null): MetricValue | undefined => part ?? undefined

const metricOf = (parts: MetricParts, metric: MetricKey): MetricValue | undefined => {
	switch (metric) {
		case 'pageviews':
			return count(parts.pageviews)
		case 'events':
			return count(parts.events)
		case 'visitors':
			return count(parts.visitors)
		case 'visits':
		case 'sessions':
			return count(parts.sessions)
		case 'conversions':
			return count(parts.conversions)
		case 'revenue':
			return count(parts.revenue)
		case 'impressions':
			return count(parts.impressions)
		case 'interactions':
			return count(parts.interactions)
		case 'avgDuration':
			return ratio(parts.durationMs, parts.pageviews)
		case 'visitDuration':
			return ratio(parts.sessionMs, parts.sessions)
		case 'bounceRate':
			return ratio(parts.bounces, parts.entries, 100)
		case 'scrollDepth': {
			// One engagement is capped on the wire, but nothing caps how many arrive for a pageview.
			const depth = ratio(parts.scrollSum, parts.scrollSamples)
			return typeof depth === 'number' ? Math.min(100, depth) : depth
		}
	}
}

/**
 * The metrics a read asked for, each average its own numerator over its own denominator. A metric
 * the row's kind does not count is left out rather than read as zero.
 */
export const partsToMetrics = (parts: MetricParts, metrics: readonly MetricKey[]): MetricValues => {
	const out: MetricValues = {}
	for (const metric of metrics) {
		const value = metricOf(parts, metric)
		if (value !== undefined) {
			out[metric] = value
		}
	}
	return out
}
