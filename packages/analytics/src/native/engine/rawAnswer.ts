import type { AnalyticsQuery, AnalyticsRow, DimensionKey, MetricValues } from '../../core/contract'
import { calendarDayOf, calendarDayStart } from '../../timeframe/calendar'
import { partsToMetrics } from '../store/parts'
import { isRawDimension, type RawDimension } from '../store/rawRead'
import type { EventStore, RawRead, RawRow } from '../store/types'
import { bucketInstant, bucketStarts } from './buckets'
import { datesOf, daySpan, hourStarts } from './days'
import { axisOf, orderOf, readFilters, seriesOf } from './planner'

/** The answer the engine's planned one is held to: its rows and totals. */
interface RawAnswer {
	rows: AnalyticsRow[]
	totals: MetricValues
}

/**
 * A read answered by one raw read per question over its whole range, nothing aggregated or
 * merged: the reference the engine's answers are tested against. The plugin never reads through it.
 */
export const rawAnswer = async (
	store: EventStore,
	query: AnalyticsQuery,
	at: { scope?: string; tz: string }
): Promise<RawAnswer> => {
	const filters = readFilters(query)
	const breakdown = query.dimensions?.find((dimension): dimension is RawDimension =>
		isRawDimension(dimension)
	)
	const series = seriesOf(query, breakdown)
	const start = query.dateRange.start
	const end = new Date(query.dateRange.end.getTime() + 1)
	const labelZone = query.timezone ?? at.tz
	const base: RawRead = {
		...(at.scope === undefined ? {} : { scope: at.scope }),
		start,
		end,
		from: calendarDayStart(calendarDayOf(start, at.tz), at.tz),
		...(query.hostname === undefined ? {} : { hostname: query.hostname }),
		filters,
		sessions: true,
		timeoutMs: 60_000,
	}
	const metricsOf = (row: RawRow): MetricValues => partsToMetrics(row.parts, query.metrics)
	const [total] = await store.readRaw(base)
	const totals = total ? metricsOf(total) : {}
	if (breakdown !== undefined) {
		const limit = query.limit !== undefined && query.limit > 0 ? { limit: query.limit } : {}
		const rows = await store.readRaw({
			...base,
			groupBy: breakdown,
			order: orderOf(query, axisOf(filters, breakdown)),
			...limit,
		})
		return {
			totals,
			rows: rows.flatMap((row) => {
				if (row.value === null) {
					return []
				}
				const dimensions: Partial<Record<DimensionKey, string>> = {}
				dimensions[breakdown] = row.value
				return [{ dimensions, metrics: metricsOf(row) }]
			}),
		}
	}
	if (series === undefined) {
		return { totals, rows: [{ metrics: totals }] }
	}
	const span = daySpan(start, end, at.tz)
	const buckets =
		series === 'hour'
			? hourStarts(start, end, labelZone)
			: !span
				? []
				: series === 'day'
					? datesOf(span.first, span.last).map((day) => calendarDayStart(day, at.tz))
					: bucketStarts(span.first, span.last, series).map((first) => bucketInstant(first, at.tz))
	if (buckets.length === 0) {
		return { totals, rows: [] }
	}
	const rows = await store.readRaw({ ...base, buckets })
	return {
		totals,
		rows: rows.flatMap((row) => {
			const bucket = row.bucket === undefined ? undefined : buckets[row.bucket]
			if (!bucket) {
				return []
			}
			const timestamp =
				series === 'hour'
					? bucket
					: series === 'day'
						? calendarDayStart(calendarDayOf(bucket, at.tz), labelZone)
						: bucketInstant(calendarDayOf(bucket, at.tz), labelZone)
			return [{ timestamp: timestamp.toISOString(), metrics: metricsOf(row) }]
		}),
	}
}
