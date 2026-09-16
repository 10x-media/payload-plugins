import type { PayloadHandler } from 'payload'
import type { MetricKey } from '../core/contract'
import { queryError } from '../query/errors'
import { readForWidgetRealtime } from '../widgets/readForWidgetRealtime'
import { REALTIME_PATH } from './paths'
import { errorResponse, NO_STORE, RETRY_AFTER } from './responses'
import { getRuntime, readAccessFor } from './runtime'

export { REALTIME_PATH }

const ALLOWED_METRICS: MetricKey[] = ['visitors', 'pageviews']
const ALLOWED_WINDOWS = [5, 15, 30, 60]
const DEFAULT_WINDOW = 30

/**
 * Authenticated GET handler for the realtime widget poller. Reads + clamps the query
 * params, then delegates to readForWidgetRealtime. Returns 401 for an anonymous request
 * and 403 when `access.read` denies, which defaults to any authenticated user (not
 * admin-panel access specifically); the response is integer counts only. A source that
 * throws answers a retryable 503 rather than an unhandled 500: the widget polls this every
 * few seconds, and a provider outage is not a reason to burn a stack trace per poll. Only
 * the read is retryable, though, so an `access.read` resolver that throws answers 500: that
 * is a configuration bug, and telling the poller to come back would only repeat it. Every
 * answer is `no-store`, since what it counts depends on the caller's own scope.
 */
export const makeRealtimeHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
	}
	try {
		const runtime = getRuntime(req.payload)
		// No runtime means no adapter to read, so the skipped gate protects no data.
		if (runtime && !(await readAccessFor(runtime, req))) {
			return Response.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE })
		}
		const params = new URL(req.url ?? '', 'http://localhost').searchParams
		const rawMetric = params.get('metric')
		const metric: MetricKey = ALLOWED_METRICS.includes(rawMetric as MetricKey)
			? (rawMetric as MetricKey)
			: 'visitors'
		const rawWindow = Number(params.get('windowMinutes'))
		const windowMinutes = ALLOWED_WINDOWS.includes(rawWindow) ? rawWindow : DEFAULT_WINDOW
		const dataSource = params.get('dataSource') ?? undefined
		try {
			const result = await readForWidgetRealtime({
				req,
				metric,
				windowMinutes,
				adapterId: dataSource,
				now: new Date(),
			})
			return Response.json(result, { headers: NO_STORE })
		} catch (err) {
			req.payload.logger?.warn(`analytics: realtime read failed: ${String(err)}`)
			return errorResponse(
				503,
				queryError('unavailable', 'analytics: source is temporarily unavailable'),
				RETRY_AFTER
			)
		}
	} catch (err) {
		req.payload.logger?.warn(`analytics: realtime request failed: ${String(err)}`)
		return errorResponse(500, queryError('internal', 'analytics: realtime read failed'))
	}
}
