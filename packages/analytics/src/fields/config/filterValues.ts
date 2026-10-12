import { metricReaches } from '../../core/capabilities'
import type { DimensionKey, MetricKey } from '../../core/contract'
import { fetchQuery } from '../../query/fetchQuery'
import { DAY_MS } from '../../timeframe/tz'
import { keys, type TranslationKey } from '../../translations/keys'
import { createSharedCache } from '../../ui/data/sharedCache'
import { DIMENSION_METRICS } from '../../view/gating'
import type { WireSource } from './fetchSources'

/** How many days of history the value list is drawn from. */
export const SUGGESTION_DAYS = 30

/** How many values the picker offers; more than this is a report, not a picker. */
export const SUGGESTION_LIMIT = 20

/** The inclusive day window the suggestions are read over, as the endpoint takes it. */
export const suggestionRange = (now: Date): { from: string; to: string } => ({
	from: new Date(now.getTime() - (SUGGESTION_DAYS - 1) * DAY_MS).toISOString().slice(0, 10),
	to: now.toISOString().slice(0, 10),
})

/**
 * Metric to rank the dimension's values by, narrowed to what the source serves. Null (source
 * serves none of the dimension's own columns) means leave the field a plain text input.
 */
export const suggestionMetric = (args: {
	dimension: DimensionKey
	source?: WireSource | undefined
}): MetricKey | null => {
	const { dimension, source } = args
	const candidates: MetricKey[] = DIMENSION_METRICS[dimension] ?? [
		'visitors',
		'pageviews',
		'events',
	]
	if (!source) {
		return candidates[0] ?? null
	}
	const served = new Set<string>(source.capabilities.metrics)
	if (!source.capabilities.dimensions.includes(dimension)) {
		return null
	}
	return (
		candidates.find(
			(metric) =>
				served.has(metric) &&
				metricReaches(source.capabilities, metric, { dimensions: [dimension] })
		) ?? null
	)
}

const cache = createSharedCache<string[]>()

interface FilterValuesArgs {
	/** The query endpoint's URL, as `fetchQuery` takes it. */
	endpoint: string
	/** The request scope the list is read for (`useRequestScope`). */
	scope: string
	dimension: DimensionKey
	metric: MetricKey
	source?: string | undefined
	now: Date
}

/**
 * Dimension's most common values over the last month, shared per scope, dimension, metric and
 * source; never joins a fetch running for another scope, and a failure drops its entry.
 */
export const fetchFilterValues = (args: FilterValuesArgs): Promise<string[]> => {
	const { endpoint, scope, dimension, metric, source, now } = args
	return cache.read(
		{ route: endpoint, scope, path: `${dimension}:${metric}:${source ?? ''}` },
		async () => {
			const response = await fetchQuery(
				endpoint,
				{
					metrics: [metric],
					dimensions: [dimension],
					...suggestionRange(now),
					limit: SUGGESTION_LIMIT,
					order: { metric, direction: 'desc' },
					...(source === undefined ? {} : { source }),
				},
				{ scope }
			)
			const seen = new Set<string>()
			for (const row of response.result.rows) {
				const value = row.dimensions?.[dimension]
				if (typeof value === 'string' && value.trim() !== '') {
					seen.add(value)
				}
			}
			return [...seen].slice(0, SUGGESTION_LIMIT)
		}
	)
}

/** What to type per dimension; campaign tags share one hint, as do region and city. */
export const FILTER_HINT_KEYS: Record<DimensionKey, TranslationKey> = {
	page: keys.filterHintPage,
	referrer: keys.filterHintReferrer,
	source: keys.filterHintSource,
	channel: keys.filterHintChannel,
	medium: keys.filterHintUtm,
	campaign: keys.filterHintUtm,
	utmSource: keys.filterHintUtm,
	utmMedium: keys.filterHintUtm,
	utmCampaign: keys.filterHintUtm,
	utmContent: keys.filterHintUtm,
	utmTerm: keys.filterHintUtm,
	device: keys.filterHintDevice,
	browser: keys.filterHintBrowser,
	os: keys.filterHintOs,
	country: keys.filterHintCountry,
	region: keys.filterHintPlace,
	city: keys.filterHintPlace,
	language: keys.filterHintLanguage,
	event: keys.filterHintEvent,
	goal: keys.filterHintGoal,
	currency: keys.filterHintCurrency,
	item: keys.filterHintItem,
}

/**
 * Placeholder per dimension. These are stored values, not prose, so they carry no translation
 * key: a translated `/pricing` would show a value the data never holds.
 */
export const FILTER_VALUE_EXAMPLES: Partial<Record<DimensionKey, string>> = {
	page: '/pricing',
	referrer: 'google.com',
	source: 'google.com',
	channel: 'organic-search',
	utmCampaign: 'spring-sale',
	campaign: 'spring-sale',
	device: 'mobile',
	browser: 'chrome',
	os: 'macos',
	country: 'DE',
	language: 'de-DE',
	event: 'signup',
	goal: 'newsletter-signup',
}
