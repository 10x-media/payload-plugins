import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, DateRange, DimensionKey, MetricKey } from '../core/contract'
import { getRuntime } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import type { WidgetReadStatus } from './readForWidget'

export interface BreakdownRow {
	label: string
	value: number
}

export interface WidgetBreakdownResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	rows: BreakdownRow[]
}

export interface ReadForWidgetBreakdownArgs {
	req: PayloadRequest
	metric: MetricKey
	dimension: DimensionKey
	timeframe: TimeframePreset
	limit: number
	adapterId?: string
	now: Date
}

/**
 * Site-wide ranked breakdown of one metric by one dimension, read through the engine.
 * Mirrors `readForWidget` but gates on the dimension too and maps each result row to a
 * `{ label, value }` pair the bar list renders. The adapter owns sorting and limiting.
 */
export const readForWidgetBreakdown = async (
	args: ReadForWidgetBreakdownArgs
): Promise<WidgetBreakdownResult> => {
	const { req, metric, dimension, timeframe, limit, adapterId, now } = args
	const dateRange = resolveTimeframe(timeframe, now)
	const base = { dateRange, rows: [] as BreakdownRow[] }

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return { status: 'unavailable', adapterId: adapterId ?? '', ...base }
	}
	let adapter: AnalyticsAdapter
	try {
		adapter = adapterId ? runtime.registry.get(adapterId) : runtime.registry.default()
	} catch {
		return { status: 'unavailable', adapterId: adapterId ?? '', ...base }
	}
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, ...base }
	}
	if (
		!satisfiesCapabilities(adapter.capabilities, { metrics: [metric], dimensions: [dimension] })
	) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const result = await runtime.engine.read(adapter, {
		metrics: [metric],
		dimensions: [dimension],
		dateRange,
		limit,
		order: { metric, direction: 'desc' },
	})
	const rows = result.rows.map((row) => ({
		label: row.dimensions?.[dimension] ?? '(none)',
		value: row.metrics[metric] ?? 0,
	}))
	return { status: 'ok', adapterId: adapter.id, dateRange, rows }
}
