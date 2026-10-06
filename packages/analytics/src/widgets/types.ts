import type { DimensionKey, FilterOperator, MetricKey } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'

export interface WidgetRange {
	from?: string
	to?: string
}

/**
 * The optional one-filter group a widget stores. Every part is optional because the group
 * is only ever partly filled while it is being configured; a filter counts as set once it
 * has a dimension and a value.
 */
export interface WidgetFilter {
	dimension?: DimensionKey
	operator?: FilterOperator
	value?: string
}

export interface MetricWidgetData {
	title?: string
	metric?: MetricKey
	timeframe?: TimeframePreset | 'custom'
	range?: WidgetRange
	dataSource?: string
	/** Trend widget only: overlay the previous period on the chart. */
	compare?: boolean
	filter?: WidgetFilter
}

export interface GoalsWidgetData {
	title?: string
	timeframe?: TimeframePreset | 'custom'
	range?: WidgetRange
	/** One of {@link GOAL_ROW_LIMITS}, stored as the select's string value. */
	limit?: string | number
	compare?: boolean
	dataSource?: string
}

/** Row counts the goals widget offers; the first is its default. */
export const GOAL_ROW_LIMITS = [10, 25, 50] as const

export type GoalRowLimit = (typeof GOAL_ROW_LIMITS)[number]

/** The stored select value as a row count, falling back to the default for anything else. */
export const resolveGoalRowLimit = (value: unknown): GoalRowLimit => {
	const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
	const match = GOAL_ROW_LIMITS.find((limit) => limit === parsed)
	return match ?? GOAL_ROW_LIMITS[0]
}

export const WIDGET_METRICS: MetricKey[] = [
	'pageviews',
	'visitors',
	'sessions',
	'avgDuration',
	'bounceRate',
	'events',
	'conversions',
	'revenue',
	'scrollDepth',
]
