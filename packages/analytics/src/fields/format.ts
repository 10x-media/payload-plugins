import type { MetricKey } from '../core/contract'

export const formatDuration = (ms: number): string => {
	const totalSeconds = Math.round(ms / 1000)
	if (totalSeconds < 60) return `${totalSeconds}s`
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
	const hours = Math.floor(minutes / 60)
	const remMinutes = minutes % 60
	return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`
}

export const formatCount = (value: number, locale: string): string =>
	new Intl.NumberFormat(locale).format(value)

const PERCENT_METRICS: ReadonlySet<MetricKey> = new Set(['bounceRate', 'scrollDepth'])

export const formatMetricValue = (metric: MetricKey, value: number, locale: string): string => {
	if (metric === 'avgDuration') return formatDuration(value)
	if (PERCENT_METRICS.has(metric)) return `${Math.round(value)}%`
	return formatCount(value, locale)
}
