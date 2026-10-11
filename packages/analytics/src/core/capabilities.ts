import {
	type AnalyticsCapabilities,
	type AnalyticsFilter,
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
	type FilterOperatorMap,
	type Granularity,
	type MetricKey,
	type MetricReach,
} from './contract'
import { onlyKeys } from './values'

/** A filter's dimension and operator: what a source has to accept for the filter to apply. */
export type FilterPair = Pick<AnalyticsFilter, 'dimension' | 'operator'>

export interface CapabilityRequirement {
	metrics?: MetricKey[]
	dimensions?: DimensionKey[]
	/**
	 * Filters the source must accept: a dimension alone asks that it filter by that dimension at
	 * all, a pair that it filter by it with that operator.
	 */
	filters?: ReadonlyArray<DimensionKey | FilterPair>
	realtime?: boolean
	perItemQuery?: boolean
	/** The read is about one page (`AnalyticsQuery.path`), which a metric needing `page` accepts. */
	path?: boolean
}

/** Every key a {@link CapabilityRequirement} takes. */
export const CAPABILITY_REQUIREMENT_KEYS = [
	'metrics',
	'dimensions',
	'filters',
	'realtime',
	'perItemQuery',
	'path',
] as const satisfies ReadonlyArray<keyof CapabilityRequirement>

/** Retired requirement keys and their replacements; a Map, so no caller's key hits a prototype. */
const RETIRED_REQUIREMENT_KEYS: ReadonlyMap<string, string> = new Map([
	['perPageQuery', "path: true, for a widget that reads one page's numbers"],
	[
		'filterOperators',
		"filters naming each operator with its dimension, such as filters: [{ dimension: 'page', operator: 'contains' }]",
	],
])

/**
 * Refuses a requirement key no source is checked against, naming the replacement of a retired one:
 * an ignored key would register the widget where it should be left out.
 */
export const assertRequirementKeys = (value: Record<string, unknown>, path: string): void => {
	for (const key of Object.keys(value)) {
		const replacement = RETIRED_REQUIREMENT_KEYS.get(key)
		if (replacement !== undefined) {
			throw new Error(`analytics: ${path}.${key} is gone since 1.0.0-beta.12; use ${replacement}`)
		}
	}
	onlyKeys(value, CAPABILITY_REQUIREMENT_KEYS, path)
}

/** The operators a source filters one dimension with, in contract order; empty when it cannot. */
export const filterOperatorsFor = (
	caps: { filters?: FilterOperatorMap },
	dimension: DimensionKey
): FilterOperator[] => {
	const offered = caps.filters?.[dimension] ?? []
	return FILTER_OPERATORS.filter((operator) => offered.includes(operator))
}

/** Whether a source applies a filter of this dimension and operator. */
export const supportsFilter = (
	caps: { filters?: FilterOperatorMap },
	filter: FilterPair
): boolean => filterOperatorsFor(caps, filter.dimension).includes(filter.operator)

/** The first filter the source cannot apply, named so a refusal can say which one it was. */
export const unsupportedFilter = <F extends FilterPair>(
	caps: { filters?: FilterOperatorMap },
	filters: readonly F[]
): F | undefined => filters.find((filter) => !supportsFilter(caps, filter))

/** The dimensions a source filters by at all, in contract order. */
export const filterableDimensions = (caps: { filters?: FilterOperatorMap }): DimensionKey[] =>
	DIMENSION_KEYS.filter((dimension) => filterOperatorsFor(caps, dimension).length > 0)

/** Whether a source meets one entry of a requirement's `filters`. */
export const meetsFilter = (
	caps: { filters?: FilterOperatorMap },
	wanted: DimensionKey | FilterPair
): boolean =>
	typeof wanted === 'string'
		? filterOperatorsFor(caps, wanted).length > 0
		: supportsFilter(caps, wanted)

/** What a read is about, as far as where a source reads a metric depends on it. */
export interface ReadShape {
	dimensions?: readonly DimensionKey[]
	/** The read's filters, or only the dimensions it filters by. */
	filters?: ReadonlyArray<DimensionKey | FilterPair>
	/** The read is about one page (`AnalyticsQuery.path`). */
	path?: boolean
}

type ReachMap = Partial<Record<MetricKey, MetricReach>>

const filtersBy = (shape: ReadShape, dimension: DimensionKey): boolean =>
	shape.filters?.some(
		(filter) => (typeof filter === 'string' ? filter : filter.dimension) === dimension
	) ?? false

/**
 * Why a source cannot read `metric` for a read of this shape: the dimension it cannot break the
 * metric down by, or the one the read lacks. Null when it can.
 */
export const metricOutOfReach = (
	caps: { metricReach?: ReachMap },
	metric: MetricKey,
	shape: ReadShape
): { breakdown: DimensionKey } | { needs: DimensionKey } | null => {
	const reach = caps.metricReach?.[metric]
	if (!reach) {
		return null
	}
	const allowed = reach.dimensions
	const breakdown = allowed ? shape.dimensions?.find((d) => !allowed.includes(d)) : undefined
	if (breakdown !== undefined) {
		return { breakdown }
	}
	const needs = reach.requires
	if (
		needs !== undefined &&
		!shape.dimensions?.includes(needs) &&
		!filtersBy(shape, needs) &&
		!(needs === 'page' && shape.path === true)
	) {
		return { needs }
	}
	return null
}

/** Whether a source reads `metric` for a read of this shape, per its `metricReach`. */
export const metricReaches = (
	caps: { metricReach?: ReachMap },
	metric: MetricKey,
	shape: ReadShape
): boolean => metricOutOfReach(caps, metric, shape) === null

/** Whether each of a requirement's metrics is read for the shape the requirement describes. */
export const metricsReach = (
	caps: { metricReach?: ReachMap },
	req: CapabilityRequirement
): boolean =>
	req.metrics?.every((metric) =>
		metricReaches(caps, metric, {
			...(req.dimensions ? { dimensions: req.dimensions } : {}),
			...(req.filters ? { filters: req.filters } : {}),
			...(req.path ? { path: true } : {}),
		})
	) ?? true

/** Whether a source meets every part of a requirement. */
export function satisfiesCapabilities(
	caps: AnalyticsCapabilities,
	req: CapabilityRequirement
): boolean {
	if (req.realtime && !caps.realtime) return false
	if (req.perItemQuery && caps.perItemQuery !== true) return false
	if (req.metrics?.some((m) => !caps.metrics.has(m))) return false
	if (req.dimensions?.some((d) => !caps.dimensions.has(d))) return false
	if (req.filters?.some((wanted) => !meetsFilter(caps, wanted))) return false
	return metricsReach(caps, req)
}

/**
 * Whether a source compares against its previous period. The engine does that read
 * generically, so it is on unless an adapter opted out.
 */
export const comparisonOf = (caps: AnalyticsCapabilities): boolean => caps.comparison ?? true

/**
 * Wire form of AnalyticsCapabilities for client pickers: an allowlist, so adapter internals (rate
 * limits, TTLs) never become client contract by accident.
 */
export type SerializedCapabilities = {
	metrics: MetricKey[]
	dimensions: DimensionKey[]
	/** The operators each filterable dimension takes, both in contract order. */
	filters: Partial<Record<DimensionKey, FilterOperator[]>>
	/** Where each metric the source cannot read under every breakdown is read; absent when none. */
	metricReach?: Partial<Record<MetricKey, { dimensions?: DimensionKey[]; requires?: DimensionKey }>>
	realtime: boolean
	realtimeWindowMinutes?: number
	/** Present, and true, only on a source that answers one content item's reads. */
	perItemQuery?: boolean
	comparison: boolean
	minGranularity: Granularity
	maxLookbackDays: number | null
}

const serializeFilters = (
	caps: AnalyticsCapabilities
): Partial<Record<DimensionKey, FilterOperator[]>> => {
	const filters: Partial<Record<DimensionKey, FilterOperator[]>> = {}
	for (const dimension of filterableDimensions(caps)) {
		filters[dimension] = filterOperatorsFor(caps, dimension)
	}
	return filters
}

const serializeReach = (
	caps: AnalyticsCapabilities
): SerializedCapabilities['metricReach'] | undefined => {
	const out: NonNullable<SerializedCapabilities['metricReach']> = {}
	for (const metric of caps.metrics) {
		const reach = caps.metricReach?.[metric]
		if (reach) {
			out[metric] = {
				...(reach.dimensions ? { dimensions: [...reach.dimensions] } : {}),
				...(reach.requires !== undefined ? { requires: reach.requires } : {}),
			}
		}
	}
	return Object.keys(out).length > 0 ? out : undefined
}

export const serializeCapabilities = (caps: AnalyticsCapabilities): SerializedCapabilities => {
	const metricReach = serializeReach(caps)
	return {
		metrics: [...caps.metrics],
		dimensions: [...caps.dimensions],
		filters: serializeFilters(caps),
		...(metricReach ? { metricReach } : {}),
		realtime: caps.realtime,
		...(caps.realtimeWindowMinutes !== undefined
			? { realtimeWindowMinutes: caps.realtimeWindowMinutes }
			: {}),
		...(caps.perItemQuery === true ? { perItemQuery: true } : {}),
		comparison: comparisonOf(caps),
		minGranularity: caps.minGranularity,
		maxLookbackDays: caps.maxLookbackDays,
	}
}
