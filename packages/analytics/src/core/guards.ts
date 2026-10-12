import { METRIC_KEYS } from '../translations/metricKeys'
import {
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
	type Granularity,
	type MetricKey,
} from './contract'
import { GRANULARITY_ORDER } from './granularity'
import { isOneOf } from './values'

/** Whether `value` names a metric the contract defines. */
export const isMetricKey = (value: unknown): value is MetricKey =>
	typeof value === 'string' && Object.hasOwn(METRIC_KEYS, value)

/** Whether `value` names a dimension the contract defines. */
export const isDimensionKey = (value: unknown): value is DimensionKey =>
	isOneOf(DIMENSION_KEYS, value)

/** Whether `value` names a filter operator the contract defines. */
export const isFilterOperator = (value: unknown): value is FilterOperator =>
	isOneOf(FILTER_OPERATORS, value)

/** Whether `value` names a bucket the contract defines. */
export const isGranularity = (value: unknown): value is Granularity =>
	isOneOf(GRANULARITY_ORDER, value)
