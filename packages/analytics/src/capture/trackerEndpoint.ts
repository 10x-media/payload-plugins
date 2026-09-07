import type { Endpoint, PayloadHandler } from 'payload'
import { TRACKER_PATH } from '../plugin/paths'
import { getRuntime } from '../plugin/runtime'
import { emptyTrackerConfig, resolveTrackerConfig } from './trackerConfig'

export { TRACKER_PATH }

/**
 * Public GET serving the browser tracker its per-request configuration. Like the capture
 * proxy, it runs with no `req.user` and calls the host's `scopeResolver` on behalf of an
 * anonymous visitor: a resolver that throws or resolves nothing leaves the tenant slot
 * absent rather than failing the request, so a broken resolver degrades capture instead of
 * breaking the page.
 *
 * The response is per-visitor and hostname-derived, never shared: `private` with a short
 * max-age, `Vary: Host, Cookie` (a `scopeResolver` may read `req.user` or a tenant cookie,
 * which makes the body cookie-dependent), and no cookie of its own.
 */
export const makeTrackerHandler = (): PayloadHandler => async (req) => {
	const runtime = getRuntime(req.payload)
	const config = runtime ? await resolveTrackerConfig({ runtime, req }) : emptyTrackerConfig(req)
	return Response.json(config, {
		headers: { 'cache-control': 'private, max-age=60', vary: 'Host, Cookie' },
	})
}

export const trackerEndpoint = (): Endpoint => ({
	method: 'get',
	path: TRACKER_PATH,
	handler: makeTrackerHandler(),
})
