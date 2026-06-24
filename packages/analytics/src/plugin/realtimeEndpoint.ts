import type { PayloadHandler } from 'payload'
import type { MetricKey } from '../core/contract'
import { readForWidgetRealtime } from '../widgets/readForWidgetRealtime'

const ALLOWED_METRICS: MetricKey[] = ['visitors', 'pageviews']
const ALLOWED_WINDOWS = [5, 15, 30, 60]
const DEFAULT_WINDOW = 30

export const REALTIME_PATH = '/analytics/realtime'

/**
 * Authenticated GET handler for the realtime widget poller. Reads + clamps the query
 * params, then delegates to readForWidgetRealtime. Returns 401 when there is no
 * `req.user` (realtime analytics must not be public).
 */
export const makeRealtimeHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return Response.json({ error: 'unauthorized' }, { status: 401 })
	}
	const params = new URL(req.url ?? '', 'http://localhost').searchParams
	const rawMetric = params.get('metric')
	const metric: MetricKey = ALLOWED_METRICS.includes(rawMetric as MetricKey)
		? (rawMetric as MetricKey)
		: 'visitors'
	const rawWindow = Number(params.get('windowMinutes'))
	const windowMinutes = ALLOWED_WINDOWS.includes(rawWindow) ? rawWindow : DEFAULT_WINDOW
	const dataSource = params.get('dataSource') ?? undefined
	const result = await readForWidgetRealtime({
		req,
		metric,
		windowMinutes,
		adapterId: dataSource,
		now: new Date(),
	})
	return Response.json(result)
}
