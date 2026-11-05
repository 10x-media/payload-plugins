import type { MetricKey } from '../core/contract'

/**
 * `visits` and `sessions` are one count the admin labels Visits, so a list holding both keeps
 * `sessions`, the name every built-in source serves.
 */
export const withoutVisitsAlias = (metrics: readonly MetricKey[]): MetricKey[] =>
	metrics.includes('sessions') && metrics.includes('visits')
		? metrics.filter((metric) => metric !== 'visits')
		: [...metrics]
