import type { PayloadHandler } from 'payload'
import { serializeCapabilities } from '../core/capabilities'
import {
	type AnalyticsQuery,
	type AnalyticsResult,
	type DateRange,
	PLATFORM_SCOPE,
} from '../core/contract'
import { resolveQueryScope } from '../core/scopedRead'
import { queryError } from '../query/errors'
import { parseQueryParams, readParam } from '../query/parse'
import type { QueryResponse, SerializedAnalyticsQuery } from '../query/response'
import { previousWindow, withinLookback } from '../widgets/comparison'
import { goalSlugsFor } from './goalHint'
import { QUERY_PATH } from './paths'
import { resolveSourcesForRequest } from './readContextForRequest'
import { errorResponse, NO_STORE, RETRY_AFTER } from './responses'
import { getRuntime, platformReadGate, readAccessFor, resolveTimezoneFor } from './runtime'

export { QUERY_PATH }

const serializeQuery = (query: AnalyticsQuery): SerializedAnalyticsQuery => ({
	...query,
	dateRange: {
		start: query.dateRange.start.toISOString(),
		end: query.dateRange.end.toISOString(),
	},
})

/**
 * Authenticated GET over the surfacing engine: the public read primitive the admin view
 * and consumers' own dashboards are built on. Gating runs in a fixed order so a caller
 * learns nothing from the answer it is not already entitled to: authentication, then
 * `access.read`, then scope and source resolution (shared with the sources endpoint, so a
 * tenant can select no source that endpoint does not list), then capability validation of
 * every parameter against the selected source. Being listed is not sufficient: a shared
 * source that cannot narrow to the caller's scope answers 403 with `param: 'source'`.
 * Errors carry a code and the parameter at fault; adapter configuration and upstream error
 * text never reach the response.
 */
export const makeQueryHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return errorResponse(401, queryError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		// Both `unavailable` answers are retryable, so both carry the same delay: a client
		// backs off identically whether the plugin is still booting or a provider is down.
		return errorResponse(503, queryError('unavailable', 'analytics: not available'), RETRY_AFTER)
	}
	let adapterId = 'unresolved'
	try {
		if (!(await readAccessFor(runtime, req))) {
			return errorResponse(403, queryError('forbidden', 'analytics: read access denied'))
		}
		const params = new URL(req.url ?? '', 'http://localhost').searchParams
		const platformRead = platformReadGate(runtime, req)
		const requestedScope = readParam(params, 'scope')
		if (requestedScope !== null && !(await platformRead())) {
			return errorResponse(
				400,
				queryError('untrusted_scope', 'analytics: scope is not permitted for this request', 'scope')
			)
		}
		const context = await resolveSourcesForRequest(req, {
			platformRead,
			...(requestedScope === null ? {} : { scope: requestedScope }),
		})
		if (context.adapters.size === 0) {
			return errorResponse(
				404,
				queryError('unknown_source', 'analytics: no source is available for this request')
			)
		}
		const requestedSource = readParam(params, 'source')
		const adapter = context.adapters.get(requestedSource ?? context.defaultId ?? '')
		if (!adapter) {
			return errorResponse(404, queryError('unknown_source', 'analytics: unknown source', 'source'))
		}
		adapterId = adapter.id
		const queryScope = await resolveQueryScope({
			runtime,
			req,
			scope: context.scope,
			adapter,
			platformRead,
		})
		if (!queryScope.ok) {
			return errorResponse(
				403,
				queryError('forbidden', 'analytics: this source cannot be read for your scope', 'source')
			)
		}
		const capabilities = serializeCapabilities(adapter.capabilities)
		const timezone = await resolveTimezoneFor(
			runtime,
			req,
			context.scope === PLATFORM_SCOPE ? null : context.scope
		)
		const parsed = parseQueryParams(params, { capabilities, timezone })
		if (!parsed.ok) {
			return errorResponse(400, parsed.error)
		}
		const goalSlugs = await goalSlugsFor({
			runtime,
			req,
			scope: context.scope === PLATFORM_SCOPE ? null : context.scope,
			metrics: parsed.value.query.metrics,
			dimensions: parsed.value.query.dimensions,
		})
		const query: AnalyticsQuery = {
			...parsed.value.query,
			...(queryScope.queryScope === undefined ? {} : { scope: queryScope.queryScope }),
			...(goalSlugs === undefined ? {} : { goalSlugs }),
		}
		let comparisonRange: DateRange | null = null
		if (parsed.value.compare === 'previous') {
			comparisonRange = previousWindow(query.dateRange, query.timezone)
			if (!comparisonRange) {
				return errorResponse(
					400,
					queryError(
						'invalid_param',
						'analytics: the range is too long to compare against a previous period',
						'compare'
					)
				)
			}
			// The view decides this same predicate on the browser clock, so a client near the
			// floor or with a skewed clock must lose only its delta, never the whole read.
			if (
				!withinLookback(comparisonRange, adapter.capabilities.maxLookbackDays, {
					tz: query.timezone,
				})
			) {
				comparisonRange = null
			}
		}
		let result: AnalyticsResult
		let comparison: AnalyticsResult | undefined
		try {
			;[result, comparison] = await Promise.all([
				runtime.engine.read(adapter, query),
				comparisonRange
					? runtime.engine.read(adapter, { ...query, dateRange: comparisonRange })
					: undefined,
			])
		} catch (err) {
			// Neither a fresh nor a stale entry survived the read: the source is down, not the
			// request wrong, so the client is told to retry rather than to change anything.
			req.payload.logger?.warn(
				`analytics: query read failed for adapter "${adapter.id}": ${String(err)}`
			)
			return errorResponse(
				503,
				queryError('unavailable', 'analytics: source is temporarily unavailable'),
				RETRY_AFTER
			)
		}
		const body: QueryResponse = {
			result,
			...(comparison ? { comparison } : {}),
			source: {
				id: adapter.id,
				label: adapter.label,
				kind: runtime.configAdapterIds.has(adapter.id) ? 'config' : 'runtime',
			},
			capabilities,
			query: serializeQuery(query),
		}
		return Response.json(body, { headers: NO_STORE })
	} catch (err) {
		req.payload.logger?.warn(`analytics: query failed for adapter "${adapterId}": ${String(err)}`)
		return errorResponse(500, queryError('internal', 'analytics: query failed'))
	}
}
