import type { AnalyticsRow, DimensionKey, MetricValues } from '../../core/contract'
import { isLatentGoalRow } from '../../goals/latent'
import type { ItemLabels } from '../../query/response'
import type { Translate } from '../../translations/server'
import { clickRate, conversionRate } from '../../view/conversionRate'
import { CLICK_RATE_DIMENSIONS, RATE_DIMENSIONS } from '../../view/gating'
import { countryCode, isUnsetValue, valueLabel } from '../../view/labels'

/** One ranked row before it is shown: the stored value (absent when the source sent none) and its numbers. */
export interface SourceRow {
	value: string | undefined
	metrics: MetricValues
}

/** One ranked row as every surface shows it. */
export interface DisplayRow {
	/** Stable identity for a list: the stored value, or the rank where it is empty. */
	key: string
	/** The stored value, `''` when the source sent none; what a filter and a URL keep. */
	value: string
	/** What the reader sees: a goal's name, a country's, `Not set` for an empty value. */
	label: string
	/** The source answered this row with no value, so it is not one a filter can match. */
	unset: boolean
	/** The ISO country code to draw a flag for, when flags are on and the row names one. */
	flag: string | null
	metrics: MetricValues
	/**
	 * The dimension's derived rate (goal or event visitors over the site's, item clicks over views),
	 * null where a side is missing, undefined for a dimension without one.
	 */
	rate?: number | null
}

export interface DisplayContext {
	dimension: DimensionKey
	/** The source that answered, which decides how a channel or source value reads. */
	provider: string
	t: Translate
	locale: string
	/** The scope's goals, so a goal row reads as its name rather than its slug. */
	goals?: ReadonlyArray<{ slug: string; name: string }>
	/** The latent built-in goal slugs, whose rows wait for a first conversion. */
	builtinGoalSlugs?: readonly string[]
	itemLabels?: ItemLabels
	countryFlags: boolean
	/** The range's visitor total a conversion rate divides by. */
	siteVisitors?: number
}

/** The rows of a breakdown read as `toDisplayRows` takes them, for `dimension`. */
export const sourceRowsOf = (rows: readonly AnalyticsRow[], dimension: DimensionKey): SourceRow[] =>
	rows.map((row) => ({ value: row.dimensions?.[dimension], metrics: row.metrics }))

/**
 * The row mapper behind every breakdown list: goal names, `Not set` for an unfilterable empty value,
 * latent built-in goals hidden until converted, country flags and derived rates.
 */
export const toDisplayRows = (
	rows: readonly SourceRow[],
	context: DisplayContext
): DisplayRow[] => {
	const {
		dimension,
		provider,
		t,
		locale,
		goals,
		builtinGoalSlugs,
		itemLabels,
		countryFlags,
		siteVisitors,
	} = context
	const clicks = CLICK_RATE_DIMENSIONS.includes(dimension)
	const converts = RATE_DIMENSIONS.includes(dimension)
	const rateOf = (metrics: MetricValues): Pick<DisplayRow, 'rate'> => {
		if (clicks) {
			return { rate: clickRate(metrics.interactions, metrics.impressions) }
		}
		if (converts) {
			return { rate: conversionRate(metrics.visitors, siteVisitors) }
		}
		return {}
	}
	return rows
		.filter(
			(row) =>
				dimension !== 'goal' ||
				!isLatentGoalRow(row.value ?? '', row.metrics.conversions, builtinGoalSlugs)
		)
		.map((row, index) => {
			const value = row.value ?? ''
			const unset = isUnsetValue(value)
			return {
				key: unset ? `row-${index}` : value,
				value,
				label: valueLabel({
					dimension,
					value,
					provider,
					t,
					locale,
					...(goals ? { goals } : {}),
					...(itemLabels ? { itemLabels } : {}),
				}),
				unset,
				flag: countryFlags && dimension === 'country' && !unset ? countryCode(value) : null,
				metrics: row.metrics,
				...rateOf(row.metrics),
			}
		})
}
