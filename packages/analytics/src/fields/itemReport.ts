import type { DimensionKey, MetricKey } from '../core/contract'
import { keys, type TranslationKey } from '../translations/keys'

/** Metrics the panel's item report reads. */
export const ITEM_PANEL_METRICS: MetricKey[] = [
	'impressions',
	'visitors',
	'interactions',
	'conversions',
	'revenue',
]

/** An install that measures no money has no revenue to read, which is no reason to warn. */
export const ITEM_PANEL_OPTIONAL_METRICS: MetricKey[] = ['revenue']

/** Defaults of a stat row on an item. */
export const ITEM_STAT_METRICS: MetricKey[] = [
	'impressions',
	'visitors',
	'interactions',
	'conversions',
]

/** The item lists: where it was seen, then the countries and devices of the people who clicked. */
export const ITEM_PANEL_DIMENSIONS: DimensionKey[] = ['page', 'country', 'device']

/**
 * Metrics an item's own buckets count. Anything else (pageviews, sessions, time on page) would
 * always read zero for an item, so it is dropped like an unserved metric.
 */
export const ITEM_READ_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'impressions',
	'interactions',
	'visitors',
	'events',
	'conversions',
	'revenue',
])

/** Names an item report gives a metric where the metric's own name would mislead. */
const ITEM_METRIC_LABELS: Partial<Record<MetricKey, TranslationKey>> = {
	visitors: keys.itemViewers,
}

/** The name an item report gives `metric`, else `fallback`. */
export const itemMetricLabel = (metric: MetricKey, fallback: TranslationKey): TranslationKey =>
	ITEM_METRIC_LABELS[metric] ?? fallback
