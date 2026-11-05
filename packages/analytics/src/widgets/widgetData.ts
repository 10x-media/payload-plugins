import type { MetricKey } from '../core/contract'
import { isDimensionKey, isFilterOperator, isMetricKey } from '../core/guards'
import { isRecord } from '../core/values'
import { isTimeframePreset, type TimeframePreset } from '../timeframe/presets'
import type { WidgetFilter, WidgetRange } from './types'

/**
 * A widget's saved settings, each part kept only when it has the shape its field writes: a
 * hand-edited or older layout can hold anything, and a malformed part reads as unset.
 */
export interface StoredWidgetData {
	title?: string
	metric?: MetricKey
	timeframe?: TimeframePreset | 'custom'
	range?: WidgetRange
	dataSource?: string
	compare?: boolean
	filter?: WidgetFilter
	/** The breakdown's row count (a number field), or the goals table's (a select's string). */
	limit?: number | string
	/** The realtime window, a select's string. */
	windowMinutes?: number | string
}

const textOrNumber = (value: unknown): value is string | number =>
	typeof value === 'string' || typeof value === 'number'

const rangeOf = (value: unknown): WidgetRange | undefined =>
	isRecord(value)
		? {
				...(typeof value.from === 'string' ? { from: value.from } : {}),
				...(typeof value.to === 'string' ? { to: value.to } : {}),
			}
		: undefined

const filterOf = (value: unknown): WidgetFilter | undefined =>
	isRecord(value)
		? {
				...(isDimensionKey(value.dimension) ? { dimension: value.dimension } : {}),
				...(isFilterOperator(value.operator) ? { operator: value.operator } : {}),
				...(typeof value.value === 'string' ? { value: value.value } : {}),
			}
		: undefined

export const storedWidgetData = (raw: unknown): StoredWidgetData => {
	if (!isRecord(raw)) {
		return {}
	}
	const range = rangeOf(raw.range)
	const filter = filterOf(raw.filter)
	return {
		...(typeof raw.title === 'string' ? { title: raw.title } : {}),
		...(isMetricKey(raw.metric) ? { metric: raw.metric } : {}),
		...(raw.timeframe === 'custom' || isTimeframePreset(raw.timeframe)
			? { timeframe: raw.timeframe }
			: {}),
		...(range ? { range } : {}),
		...(typeof raw.dataSource === 'string' ? { dataSource: raw.dataSource } : {}),
		...(typeof raw.compare === 'boolean' ? { compare: raw.compare } : {}),
		...(filter ? { filter } : {}),
		...(textOrNumber(raw.limit) ? { limit: raw.limit } : {}),
		...(textOrNumber(raw.windowMinutes) ? { windowMinutes: raw.windowMinutes } : {}),
	}
}
