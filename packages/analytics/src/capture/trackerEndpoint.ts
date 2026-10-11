import type { Endpoint, PayloadHandler } from 'payload'
import { analyticsError, errorResponse } from '../plugin/errors'
import type { RoutePaths } from '../plugin/routes'
import { getRuntime } from '../plugin/runtime'
import { draftModeCookie, emptyTrackerConfig } from '../site/getTrackerConfig'
import { resolveTrackerConfig } from './trackerConfig'

/**
 * Public GET serving the tracker its per-request config, resolved for an anonymous visitor even when
 * an editor's browser sends credentials; a failing scope resolver drops the tenant slot only.
 */
export const makeTrackerHandler = (): PayloadHandler => async (req) => {
	const runtime = getRuntime(req.payload)
	// Read before the cookies are stripped, so a preview booted by `initTracker` goes uncounted.
	const draft = draftModeCookie(req.headers)
	try {
		const config = runtime
			? await resolveTrackerConfig({ runtime, req, draft })
			: emptyTrackerConfig(req)
		// The draft cookie changes the body, so the response is per visitor and never shared.
		return Response.json(config, {
			headers: { 'cache-control': 'private, max-age=60', vary: 'Host, Cookie' },
		})
	} catch (err) {
		req.payload.logger?.error(`analytics: tracker config failed: ${String(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: tracker config failed'))
	}
}

export const trackerEndpoint = (routes: Pick<RoutePaths, 'config'>): Endpoint => ({
	method: 'get',
	path: routes.config,
	handler: makeTrackerHandler(),
})
