import type { MetricKey, MetricValue } from '../core/contract'
import { NO_VALUE } from '../core/metricValues'
import { listFormat, numberFormat } from '../translations/intl'

type DurationUnit = 'hour' | 'minute' | 'second'

const unitFormat = (locale: string, unit: DurationUnit): Intl.NumberFormat =>
	numberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' })

/**
 * Duration in the admin language, built from unit parts rather than `Intl.DurationFormat`, which
 * Node 22 lacks while browsers have it, so server render and hydration agree.
 */
export const formatDuration = (ms: number, locale: string): string => {
	const totalSeconds = Math.max(0, Math.round(ms / 1000))
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	const parts: string[] = []
	if (hours > 0) parts.push(unitFormat(locale, 'hour').format(hours))
	if (minutes > 0) parts.push(unitFormat(locale, 'minute').format(minutes))
	if (seconds > 0 || parts.length === 0) parts.push(unitFormat(locale, 'second').format(seconds))
	return listFormat(locale, { type: 'unit', style: 'narrow' }).format(parts)
}

export const formatCount = (value: number, locale: string): string =>
	numberFormat(locale).format(value)

/** A window of whole minutes written out in the admin language: "30 minutes". */
export const formatMinutes = (minutes: number, locale: string): string =>
	numberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(minutes)

const PERCENT_METRICS: ReadonlySet<MetricKey> = new Set(['bounceRate', 'scrollDepth'])

/** Metrics read in milliseconds and written as a duration. */
const DURATION_METRICS: ReadonlySet<MetricKey> = new Set(['avgDuration', 'visitDuration'])

/** A 0..100 rate as the admin language writes a percentage, sign and spacing included. */
export const formatPercent = (value: number, locale: string): string =>
	numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100)

/**
 * Share between 0 and 1, one decimal on every surface alike; the no-value dash when either side of
 * the ratio is missing. A share under one percent keeps two significant digits rather than
 * rounding a few conversions to 0%.
 */
export const formatRate = (ratio: number | null | undefined, locale: string): string => {
	if (typeof ratio !== 'number') {
		return NO_VALUE
	}
	return ratio > 0 && ratio < 0.01
		? numberFormat(locale, { style: 'percent', maximumSignificantDigits: 2 }).format(ratio)
		: numberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(ratio)
}

/**
 * Revenue in the install's reporting currency. A code the runtime refuses falls back to a
 * plain number rather than throwing in the middle of a render.
 */
export const formatCurrency = (value: number, locale: string, currency: string): string => {
	try {
		return numberFormat(locale, { style: 'currency', currency }).format(value)
	} catch {
		return formatCount(value, locale)
	}
}

/** Admin language alone, or with the install's resolved `revenue.currency`. */
export type MetricFormat = string | { locale: string; currency?: string }

/**
 * One metric as the admin language writes it. Revenue is money only with a resolved reporting
 * currency, else a plain number; a missing or `null` reading is {@link NO_VALUE}.
 */
export const formatMetricValue = (
	metric: MetricKey,
	value: MetricValue | undefined,
	format: MetricFormat
): string => {
	if (value === null || value === undefined) {
		return NO_VALUE
	}
	const locale = typeof format === 'string' ? format : format.locale
	const currency = typeof format === 'string' ? undefined : format.currency
	if (DURATION_METRICS.has(metric)) return formatDuration(value, locale)
	if (PERCENT_METRICS.has(metric)) return formatPercent(value, locale)
	if (metric === 'revenue' && currency) return formatCurrency(value, locale, currency)
	return formatCount(value, locale)
}
