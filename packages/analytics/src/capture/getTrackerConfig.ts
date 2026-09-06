import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { getRuntime } from '../plugin/runtime'
import { emptyTrackerConfig, resolveTrackerConfig, type TrackerConfig } from './trackerConfig'

/**
 * Server-side twin of the tracker endpoint, for a Next app that renders `AnalyticsScripts`
 * itself: pass the incoming request's `headers()` and the host's `scopeResolver` sees the
 * same request it would over HTTP. `host` is lifted onto the request because Payload
 * derives `req.host` from the URL rather than the header, and hostname-derived scoping is
 * the common case.
 *
 * A fresh request object is built on every call: `createLocalReq` mutates the one it is
 * given, so a shared literal would accumulate another caller's locale, user, and loader.
 */
export const getTrackerConfig = async (
	payload: Payload,
	args?: { headers?: Headers }
): Promise<TrackerConfig> => {
	const headers = args?.headers ?? new Headers()
	const host = headers.get('host')
	const req = await createLocalReq(
		{ req: { headers, ...(host ? { host } : {}) } as Partial<PayloadRequest> },
		payload
	)
	const runtime = getRuntime(payload)
	return runtime ? resolveTrackerConfig({ runtime, req }) : emptyTrackerConfig(req)
}
