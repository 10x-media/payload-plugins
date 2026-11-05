import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { isRecord } from '../core/values'
import { apiPath } from '../plugin/apiPath'
import { ANALYTICS_CONFIG_KEY, analyticsRoutes } from '../plugin/routes'
import { DEFAULT_AUTO_CAPTURE, type TrackerConfig } from '../tracker/config'

/**
 * The cookie Next's `draftMode().enable()` sets and `disable()` clears, which is how Payload's
 * preview route turns draft mode on (`__prerender_bypass` in `next/dist/server/api-utils`).
 */
export const NEXT_DRAFT_COOKIE = '__prerender_bypass'

/**
 * Whether the request carries Next's draft mode cookie. Unverified, so a stale or forged cookie reads
 * as draft; `(await draftMode()).isEnabled` checks it against the preview id.
 */
export const draftModeCookie = (headers: Headers): boolean =>
	(headers.get('cookie') ?? '').split(';').some((pair) => {
		const [name, ...value] = pair.trim().split('=')
		return name === NEXT_DRAFT_COOKIE && value.join('=') !== ''
	})

/**
 * What the plugin's `config.custom` entry answers a site render with, so a site page reaches the
 * runtime without loading the engine, the adapters or the admin.
 */
export interface TrackerConfigSource {
	trackerConfig: (payload: Payload, req: PayloadRequest, draft: boolean) => Promise<TrackerConfig>
}

const isTrackerConfigSource = (value: unknown): value is TrackerConfigSource =>
	isRecord(value) && typeof value.trackerConfig === 'function'

/** The config for an install with no runtime: no slots, but still a usable ingest path. */
export const emptyTrackerConfig = (req: PayloadRequest): TrackerConfig => ({
	slots: [],
	autoCapture: DEFAULT_AUTO_CAPTURE,
	goals: [],
	ingestPath: apiPath(req.payload?.config ?? {}, analyticsRoutes(req.payload?.config).ingest),
})

/**
 * Server-side twin of the tracker endpoint: pass the request's `headers()` so the host's resolver
 * sees the visitor's request. Pass `draft: (await draftMode()).isEnabled`, else the cookie decides.
 */
export const getTrackerConfig = async (
	payload: Payload,
	args?: { headers?: Headers; draft?: boolean }
): Promise<TrackerConfig> => {
	const headers = args?.headers ?? new Headers()
	// Payload derives `req.host` from the URL, and hostname scoping needs the header's.
	const host = headers.get('host')
	// A fresh literal per call: `createLocalReq` mutates the request it is given.
	const req = await createLocalReq({ req: { headers, ...(host ? { host } : {}) } }, payload)
	const draft = args?.draft ?? draftModeCookie(headers)
	const source = payload.config.custom?.[ANALYTICS_CONFIG_KEY]
	return isTrackerConfigSource(source)
		? source.trackerConfig(payload, req, draft)
		: emptyTrackerConfig(req)
}
