import type { PayloadHandler, PayloadRequest } from 'payload'
import type { GatedScope } from '../access/principal'
import { readGate } from '../access/readGate'
import { currentDate } from '../core/clock'
import type { MetricKey } from '../core/contract'
import { resolveRequestedScope } from '../core/scopedRead'
import { describeWithCauses } from '../core/sourceErrors'
import { wholeNumberParam } from '../core/values'
import { readRealtimeOrThrow } from '../widgets/readForWidgetRealtime'
import { resolveBoundDocument, unloadedDocumentResponse } from './boundDocument'
import { resolveDocumentScope } from './documentScopes'
import {
	analyticsError,
	errorResponse,
	NO_STORE,
	readDeniedResponse,
	unauthorizedResponse,
	untrustedScopeResponse,
} from './errors'
import { queryParams } from './queryParams'
import { readFailureResponse } from './readFailure'
import { type AnalyticsRuntime, getRuntime, scopeGates } from './runtime'

const ALLOWED_METRICS: MetricKey[] = ['visitors', 'pageviews']
const ALLOWED_WINDOWS = [5, 15, 30, 60]
const DEFAULT_WINDOW = 30

/** What one realtime read counts: a scope other than the request's own, and one page. */
interface RealtimeTarget {
	scope?: GatedScope
	path?: string
}

/**
 * The scope and page a read counts, or the answer that replaces the read. A `collection` and `id`
 * count that document's page in the document's own tenant, whichever one the reader resolves to.
 */
const realtimeTargetOf = async (
	req: PayloadRequest,
	runtime: AnalyticsRuntime | undefined,
	params: URLSearchParams
): Promise<RealtimeTarget | Response> => {
	const gates = runtime && scopeGates(runtime, req)
	let scope: GatedScope | undefined
	if (runtime && gates) {
		const raw = params.get('scope')
		const requested = await resolveRequestedScope({ runtime, req, raw, gates })
		// An unresolvable own scope is left to the read, which answers its unavailable state.
		if (!requested.ok && (requested.reason === 'named' || requested.reason === 'not-member')) {
			return untrustedScopeResponse('scope')
		}
		scope = requested.ok && raw ? requested.gated : undefined
	}
	const collection = params.get('collection')
	if (!collection) {
		return scope === undefined ? {} : { scope }
	}
	const bound = await resolveBoundDocument({ req, collection, id: params.get('id') ?? '' })
	if (!bound.ok) {
		return unloadedDocumentResponse(bound.status)
	}
	if (runtime && gates) {
		const owner = await resolveDocumentScope({
			runtime,
			req,
			collection,
			data: bound.data,
			gates,
		})
		if (!owner.ok) {
			return untrustedScopeResponse()
		}
		if (owner.scope !== null) {
			scope = owner.gated
		}
	}
	// A document with no path yet (an unsaved slug) has no page to count, and counting the whole
	// site in its place would mislabel the number.
	if (bound.path === null) {
		return Response.json(
			{ status: 'unavailable', adapterId: '', activeNow: 0, series: [] },
			{ headers: NO_STORE }
		)
	}
	return { ...(scope === undefined ? {} : { scope }), path: bound.path }
}

/**
 * Authenticated GET for the realtime poller, answering `no-store` integer counts. `collection` and
 * `id` count one readable document's page in its own scope, gated like a named `scope`.
 */
export const makeRealtimeHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return unauthorizedResponse()
	}
	try {
		const runtime = getRuntime(req.payload)
		// No runtime means no adapter to read, so the skipped gate protects no data.
		if (runtime && !(await readGate(runtime, req))) {
			return readDeniedResponse()
		}
		const params = queryParams(req)
		const rawMetric = params.get('metric')
		const metric: MetricKey = ALLOWED_METRICS.find((allowed) => allowed === rawMetric) ?? 'visitors'
		const rawWindow = wholeNumberParam(params.get('windowMinutes'))
		const windowMinutes =
			rawWindow !== undefined && ALLOWED_WINDOWS.includes(rawWindow) ? rawWindow : DEFAULT_WINDOW
		const target = await realtimeTargetOf(req, runtime, params)
		if (target instanceof Response) {
			return target
		}
		try {
			const result = await readRealtimeOrThrow({
				req,
				metric,
				windowMinutes,
				adapterId: params.get('dataSource') ?? undefined,
				now: currentDate(),
				series: params.get('series') !== '0',
				...target,
			})
			return Response.json(result, { headers: NO_STORE })
		} catch (err) {
			req.payload.logger?.warn(`analytics: realtime read failed: ${describeWithCauses(err)}`)
			return readFailureResponse(err)
		}
	} catch (err) {
		// Only the read is retryable: a throwing `access.read` is a config bug, which a retry repeats.
		req.payload.logger?.error(`analytics: realtime request failed: ${String(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: realtime read failed'))
	}
}
