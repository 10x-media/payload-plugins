import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, DateRange, MetricKey } from '../core/contract'
import { getRuntime } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'

export type WidgetReadStatus = 'ok' | 'not-configured' | 'unavailable'

export interface WidgetReadResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	metrics: Partial<Record<MetricKey, number>>
}

export interface ReadForWidgetArgs {
	req: PayloadRequest
	metrics: MetricKey[]
	timeframe: TimeframePreset
	adapterId?: string
	now: Date
}

export const readForWidget = async (args: ReadForWidgetArgs): Promise<WidgetReadResult> => {
	const { req, metrics, timeframe, adapterId, now } = args
	const dateRange = resolveTimeframe(timeframe, now)
	const base = { dateRange, metrics: {} as Partial<Record<MetricKey, number>> }

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
	if (!satisfiesCapabilities(adapter.capabilities, { metrics })) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const result = await runtime.engine.read(adapter, { metrics, dateRange })
	return { status: 'ok', adapterId: adapter.id, dateRange, metrics: result.totals ?? {} }
}
