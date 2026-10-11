import type { AnalyticsQuery, AnalyticsResult, MetricKey } from './contract'
import { isMetricKey } from './guards'

/**
 * `visits` and `sessions` are one count under two names: every built-in source serves both from
 * the same number, or one of them alone (native counts 30-minute visits as `sessions`).
 */
const SAME_COUNT: Partial<Record<MetricKey, MetricKey>> = { visits: 'sessions', sessions: 'visits' }

type Served = ReadonlySet<MetricKey> | readonly MetricKey[]

const serves = (served: Served, metric: MetricKey): boolean =>
	'has' in served ? served.has(metric) : served.includes(metric)

/** The name `served` knows `metric` by: its own, or the other name of the same count. */
export const servedName = (metric: MetricKey, served: Served): MetricKey => {
	if (serves(served, metric)) {
		return metric
	}
	const other = SAME_COUNT[metric]
	return other !== undefined && serves(served, other) ? other : metric
}

/** A read's metrics as its source names them, and the names each answer goes back under. */
interface AliasedMetrics {
	/** What the source is asked for, each count once. */
	read: MetricKey[]
	/** Every name the caller asked for, by the source's name for it. */
	asked: ReadonlyMap<MetricKey, MetricKey[]>
}

/** Groups a read's metrics under the name `served` knows each by. */
export const aliasMetrics = (metrics: readonly MetricKey[], served: Served): AliasedMetrics => {
	const asked = new Map<MetricKey, MetricKey[]>()
	for (const metric of metrics) {
		const name = servedName(metric, served)
		asked.set(name, [...(asked.get(name) ?? []), metric])
	}
	return { read: [...asked.keys()], asked }
}

/** Whether answering under the asked names changes anything at all. */
const renames = (aliased: AliasedMetrics): boolean =>
	[...aliased.asked].some(([name, names]) => names.length !== 1 || names[0] !== name)

/** `query` as the source is asked it: its metrics, and the one it orders by, in the source's names. */
export const servedQuery = (query: AnalyticsQuery, aliased: AliasedMetrics): AnalyticsQuery => {
	if (!renames(aliased)) {
		return query
	}
	const order = query.order
	const ordered = order
		? [...aliased.asked].find(([, names]) => names.includes(order.metric))
		: undefined
	return {
		...query,
		metrics: aliased.read,
		...(order && ordered ? { order: { ...order, metric: ordered[0] } } : {}),
	}
}

const renamed = <V>(
	values: Partial<Record<MetricKey, V>> | undefined,
	aliased: AliasedMetrics
): Partial<Record<MetricKey, V>> | undefined => {
	if (values === undefined) {
		return undefined
	}
	const out: Partial<Record<MetricKey, V>> = {}
	for (const key of Object.keys(values)) {
		if (!isMetricKey(key)) {
			continue
		}
		const value = values[key]
		for (const name of aliased.asked.get(key) ?? [key]) {
			out[name] = value
		}
	}
	return out
}

/** Reads `query` under the names `served` knows and answers it under the names the caller asked for. */
export const readAsAsked = async (
	read: (query: AnalyticsQuery) => Promise<AnalyticsResult>,
	query: AnalyticsQuery,
	served: Served
): Promise<AnalyticsResult> => {
	const aliased = aliasMetrics(query.metrics, served)
	return askedResult(await read(servedQuery(query, aliased)), aliased)
}

/** `result` under the names the caller asked for: totals, rows and their samples alike. */
export const askedResult = (result: AnalyticsResult, aliased: AliasedMetrics): AnalyticsResult => {
	if (!renames(aliased)) {
		return result
	}
	const totals = renamed(result.totals, aliased)
	return {
		...result,
		rows: result.rows.map((row) => {
			const samples = renamed(row.samples, aliased)
			return {
				...row,
				metrics: renamed(row.metrics, aliased) ?? {},
				...(samples === undefined ? {} : { samples }),
			}
		}),
		...(totals === undefined ? {} : { totals }),
	}
}
