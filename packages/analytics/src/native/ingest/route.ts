import { createLocalReq, getPayload, type Payload, type SanitizedConfig } from 'payload'
import { normalizeOrigin } from '../../net/origin'
import { analyticsError, errorResponse } from '../../plugin/errors'
import { getRuntime } from '../../plugin/runtime'
import { isNativeAdapter } from '../nativeAdapter'
import { type BeaconFailureLog, beaconFailureLog } from './endpoint'

export interface IngestRouteOptions {
	/** `getPayload` cache key of the instance hits are stored through; Payload's own when unset. */
	key?: string
}

type Config = Promise<SanitizedConfig> | SanitizedConfig

const PREFLIGHT_MAX_AGE_S = 86_400

const failureLogs = new WeakMap<Payload, BeaconFailureLog>()

const logFailure = (payload: Payload, err: unknown): void => {
	const log = failureLogs.get(payload) ?? beaconFailureLog('taken')
	failureLogs.set(payload, log)
	log(payload, err)
}

const instanceOf = (config: Config, options: IngestRouteOptions): Promise<Payload> =>
	getPayload({ config, cron: true, ...(options.key === undefined ? {} : { key: options.key }) })

/**
 * The CORS headers a response to `request` carries: the request's own origin, echoed only when
 * `capture.allowedOrigins` lists it, so another listed site's page may post here.
 */
const corsHeaders = (request: Request, payload: Payload): Record<string, string> => {
	const origin = request.headers.get('origin')
	const normalized = origin === null ? null : normalizeOrigin(origin)
	if (
		origin === null ||
		normalized === null ||
		!getRuntime(payload)?.allowedOrigins?.has(normalized)
	) {
		return {}
	}
	return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
}

const withHeaders = (response: Response, extra: Record<string, string>): Response => {
	if (Object.keys(extra).length === 0) {
		return response
	}
	const headers = new Headers(response.headers)
	for (const [name, value] of Object.entries(extra)) {
		headers.set(name, value)
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

/**
 * One beacon outside Payload's REST routing, made a Payload request without running auth
 * strategies, so resolvers see a capture call site without a user, cookies or authorization.
 */
export const receiveBeacon = async (
	request: Request,
	config: Config,
	options: IngestRouteOptions
): Promise<Response> => {
	const payload = await instanceOf(config, options)
	const adapter = getRuntime(payload)?.adapters?.find(isNativeAdapter)
	if (!adapter) {
		return errorResponse(
			404,
			analyticsError('not_found', 'analytics: this install runs no native adapter to take beacons')
		)
	}
	const cors = corsHeaders(request, payload)
	let response: Response
	try {
		const req = await createLocalReq(
			{ req: Object.assign(request, { payloadAPI: 'REST' as const }) },
			payload
		)
		response = await adapter.receive(req)
	} catch (err) {
		logFailure(payload, err)
		response = errorResponse(500, analyticsError('internal', 'analytics: the beacon failed'))
	}
	return withHeaders(response, cors)
}

/**
 * The answer to a browser's preflight before a beacon from another site: allowed for an origin
 * `capture.allowedOrigins` lists, and refused (no CORS headers) for any other.
 */
export const answerPreflight = async (
	request: Request,
	config: Config,
	options: IngestRouteOptions
): Promise<Response> => {
	const cors = corsHeaders(request, await instanceOf(config, options))
	const allowed = Object.keys(cors).length > 0
	return new Response(null, {
		status: 204,
		headers: allowed
			? {
					...cors,
					'Access-Control-Allow-Methods': 'POST',
					'Access-Control-Allow-Headers': 'content-type',
					'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_S),
				}
			: { Vary: 'Origin' },
	})
}
