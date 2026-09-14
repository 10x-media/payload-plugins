import type { PayloadHandler, PayloadRequest } from 'payload'
import { serializeCapabilities } from '../core/capabilities'
import { type AnalyticsAdapter, type AnalyticsQuery, PLATFORM_SCOPE } from '../core/contract'
import { type QueryError, queryError } from '../query/errors'
import { parseQueryParams } from '../query/parse'
import type { QueryResponse, SerializedAnalyticsQuery } from '../query/response'
import { previousWindow } from '../widgets/comparison'
import { QUERY_PATH } from './paths'
import { resolveSourcesForRequest } from './readContextForRequest'
import {
	type AnalyticsRuntime,
	getRuntime,
	platformReadFor,
	readAccessFor,
	resolveTimezoneFor,
} from './runtime'

export { QUERY_PATH }

/** Scope depends on the caller's cookies, so no shared cache may ever hold an answer. */
const NO_STORE = { 'Cache-Control': 'private, no-store' }

const errorResponse = (status: number, error: QueryError): Response =>
	Response.json({ error }, { status, headers: NO_STORE })

/** A trimmed non-empty parameter, or null when absent or blank, as the parser reads them. */
const read = (params: URLSearchParams, name: string): string | null => {
	const raw = params.get(name)?.trim()
	return raw ? raw : null
}

const serializeQuery = (query: AnalyticsQuery): SerializedAnalyticsQuery => ({
	...query,
	dateRange: {
		start: query.dateRange.start.toISOString(),
		end: query.dateRange.end.toISOString(),
	},
})

/**
 * The scope stamped on the adapter query, mirroring `resolveReadContext`: a scoped read
 * through a shared config adapter that cannot filter by scope would return every scope's
 * data, so it is a cross-scope read and fails closed behind `platformRead`.
 */
const resolveQueryScope = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	scope: string | null
	adapter: AnalyticsAdapter
}): Promise<{ ok: true; queryScope?: string } | { ok: false }> => {
	const { runtime, req, scope, adapter } = args
	if (scope === null || scope === PLATFORM_SCOPE) {
		return { ok: true }
	}
	if (runtime.configAdapterIds.has(adapter.id) && !adapter.capabilities.scopedQueries) {
		return (await platformReadFor(runtime, req)) ? { ok: true } : { ok: false }
	}
	return { ok: true, queryScope: scope }
}

/**
 * Authenticated GET over the surfacing engine: the public read primitive the admin view
 * and consumers' own dashboards are built on. Gating runs in a fixed order so a caller
 * learns nothing from the answer it is not already entitled to: authentication, then
 * `access.read`, then scope and source resolution (shared with the sources endpoint, so
 * a tenant sees exactly the sources that endpoint lists), then capability validation of
 * every parameter against the selected source. Errors carry a code and the parameter at
 * fault; adapter configuration and upstream error text never reach the response.
 */
export const makeQueryHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return errorResponse(401, queryError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return errorResponse(503, queryError('unavailable', 'analytics: not available'))
	}
	let adapterId = 'unresolved'
	try {
		if (!(await readAccessFor(runtime, req))) {
			return errorResponse(403, queryError('forbidden', 'analytics: read access denied'))
		}
		const params = new URL(req.url ?? '', 'http://localhost').searchParams
		const requestedScope = read(params, 'scope')
		if (requestedScope !== null && !(await platformReadFor(runtime, req))) {
			return errorResponse(
				400,
				queryError('untrusted_scope', 'analytics: scope is not permitted for this request', 'scope')
			)
		}
		const context = await resolveSourcesForRequest(
			req,
			requestedScope === null ? {} : { scope: requestedScope }
		)
		if (context.adapters.size === 0) {
			return errorResponse(
				404,
				queryError('unknown_source', 'analytics: no source is available for this request')
			)
		}
		const requestedSource = read(params, 'source')
		const adapter = context.adapters.get(requestedSource ?? context.defaultId ?? '')
		if (!adapter) {
			return errorResponse(404, queryError('unknown_source', 'analytics: unknown source', 'source'))
		}
		adapterId = adapter.id
		const queryScope = await resolveQueryScope({ runtime, req, scope: context.scope, adapter })
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
		const query: AnalyticsQuery = {
			...parsed.value.query,
			...(queryScope.queryScope === undefined ? {} : { scope: queryScope.queryScope }),
		}
		const comparisonRange =
			parsed.value.compare === 'previous' ? previousWindow(query.dateRange, query.timezone) : null
		const [result, comparison] = await Promise.all([
			runtime.engine.read(adapter, query),
			comparisonRange
				? runtime.engine.read(adapter, { ...query, dateRange: comparisonRange })
				: undefined,
		])
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
