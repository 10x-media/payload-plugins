import type { PayloadHandler } from 'payload'
import { readGate } from '../access/readGate'
import { serializeCapabilities } from '../core/capabilities'
import { currentDate } from '../core/clock'
import type { AnalyticsQuery, AnalyticsResult, DateRange } from '../core/contract'
import { aliasMetrics, askedResult, servedQuery } from '../core/metricAliases'
import { resolveQueryScope, resolveRequestedScope } from '../core/scopedRead'
import { describeWithCauses } from '../core/sourceErrors'
import { revenueCurrencyOf } from '../goals/currency'
import { parseQueryParams, readParam } from '../query/parse'
import type { QueryResponse, SerializedAnalyticsQuery } from '../query/response'
import type { ReadOptions } from '../surfacing/engine'
import { previousWindow, withinLookback } from '../timeframe/comparison'
import {
	analyticsError,
	errorResponse,
	NO_STORE,
	notAvailableResponse,
	readDeniedResponse,
	unauthorizedResponse,
	untrustedScopeResponse,
} from './errors'
import { goalHintFor } from './goalHint'
import { itemRefsOf, resolveItemLabels } from './itemLabels'
import { queryParams } from './queryParams'
import { resolveSourcesForRequest } from './readContextForRequest'
import { readFailureResponse } from './readFailure'
import {
	getRuntime,
	resolvableScope,
	resolveCurrencyFor,
	resolveTimezoneFor,
	scopeGates,
} from './runtime'

/**
 * The query as the response echoes it, the range as ISO strings. `goalSlugs` rides along: the
 * scope's slugs, `[]` for no goals, or `'unresolved'` when the resolver failed.
 */
export const serializeQuery = (query: AnalyticsQuery): SerializedAnalyticsQuery => ({
	...query,
	dateRange: {
		start: query.dateRange.start.toISOString(),
		end: query.dateRange.end.toISOString(),
	},
})

const noSourceResponse = (): Response =>
	errorResponse(
		404,
		analyticsError('unknown_source', 'analytics: no source is available for this request')
	)

/**
 * Authenticated GET over the surfacing engine, gated in order (auth, `access.read`, scope, source,
 * capabilities) so no answer leaks past the caller's entitlement. Upstream error text never leaks.
 */
export const makeQueryHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return unauthorizedResponse()
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return notAvailableResponse()
	}
	let adapterId = 'unresolved'
	try {
		if (!(await readGate(runtime, req))) {
			return readDeniedResponse()
		}
		const params = queryParams(req)
		const gates = scopeGates(runtime, req)
		const requested = await resolveRequestedScope({
			runtime,
			req,
			raw: params.get('scope'),
			gates,
		})
		if (!requested.ok) {
			// A request whose own scope will not resolve answers like a scope with no sources.
			// A scope the caller named, or one its user does not belong to, is refused as such.
			return requested.reason === 'named' || requested.reason === 'not-member'
				? untrustedScopeResponse('scope')
				: noSourceResponse()
		}
		const context = await resolveSourcesForRequest(req, { gates, scope: requested.gated })
		if (context.adapters.size === 0) {
			return noSourceResponse()
		}
		const requestedSource = readParam(params, 'source')
		const adapter = context.adapters.get(requestedSource ?? context.defaultId ?? '')
		if (!adapter) {
			return errorResponse(
				404,
				analyticsError('unknown_source', 'analytics: unknown source', 'source')
			)
		}
		adapterId = adapter.id
		const queryScope = await resolveQueryScope({
			runtime,
			req,
			scope: context.scope,
			adapter,
			gates,
		})
		if (!queryScope.ok) {
			return errorResponse(
				403,
				analyticsError(
					'forbidden',
					'analytics: this source cannot be read for your scope',
					'source'
				)
			)
		}
		const capabilities = serializeCapabilities(adapter.capabilities)
		const ownScope = resolvableScope(context.scope)
		const timezone = await resolveTimezoneFor(runtime, req, ownScope)
		const parsed = parseQueryParams(params, { capabilities, timezone })
		if (!parsed.ok) {
			return errorResponse(400, parsed.error)
		}
		const hint = await goalHintFor({
			runtime,
			req,
			scope: ownScope,
			metrics: parsed.value.query.metrics,
			dimensions: parsed.value.query.dimensions,
		})
		const query: AnalyticsQuery = {
			...parsed.value.query,
			...(queryScope.queryScope === undefined ? {} : { scope: queryScope.queryScope }),
			...(hint === undefined ? {} : { goalSlugs: hint.slugs }),
		}
		let comparisonRange: DateRange | null = null
		if (parsed.value.compare === 'previous') {
			comparisonRange = previousWindow(query.dateRange, query.timezone)
			if (!comparisonRange) {
				return errorResponse(
					400,
					analyticsError(
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
					now: currentDate(),
				})
			) {
				comparisonRange = null
			}
		}
		// The view names the preset its days came from, so the engine can store the read for the warm
		// task when those days are the preset's today; any other window stores nothing.
		const readOptions: ReadOptions = {
			whenBusy: 'refuse',
			priority: 'interactive',
			...(parsed.value.timeframe === null ? {} : { timeframe: parsed.value.timeframe }),
		}
		// Read under the source's own names and answered under the caller's: `visits` from native.
		const aliased = aliasMetrics(query.metrics, adapter.capabilities.metrics)
		const served = servedQuery(query, aliased)
		let result: AnalyticsResult
		let comparison: AnalyticsResult | undefined
		try {
			const [read, previous] = await Promise.all([
				runtime.engine.read(adapter, served, readOptions),
				comparisonRange
					? runtime.engine.read(adapter, { ...served, dateRange: comparisonRange }, readOptions)
					: undefined,
			])
			result = askedResult(read, aliased)
			comparison = previous && askedResult(previous, aliased)
		} catch (err) {
			req.payload.logger?.warn(
				`analytics: query read failed for adapter "${adapter.id}": ${describeWithCauses(err)}`
			)
			return readFailureResponse(err)
		}
		// A shallow copy, since the cached entry is shared between requests and reporting currency
		// resolves per scope. A source naming its own revenue currency keeps it.
		const reporting = revenueCurrencyOf(
			query.filters,
			await resolveCurrencyFor(runtime, req, ownScope)
		)
		const withCurrency = (read: AnalyticsResult): AnalyticsResult =>
			reporting && read.meta.currency === undefined
				? { ...read, meta: { ...read.meta, currency: reporting } }
				: read
		const currency = result.meta.currency ?? reporting
		// Resolved per request rather than cached with the read: a title is whatever this reader
		// may see of the document, and the cached rows are shared by every reader of the scope.
		const refs = itemRefsOf(query, [result, comparison])
		const itemLabels = refs.length > 0 ? await resolveItemLabels(req, refs) : undefined
		const body: QueryResponse = {
			result: withCurrency(result),
			...(comparison ? { comparison: withCurrency(comparison) } : {}),
			...(currency ? { currency } : {}),
			source: {
				id: adapter.id,
				label: adapter.label,
				kind: runtime.configAdapterIds.has(adapter.id) ? 'config' : 'runtime',
			},
			capabilities,
			query: serializeQuery(query),
			...(hint && hint.builtin.length > 0 ? { builtinGoalSlugs: hint.builtin } : {}),
			...(itemLabels ? { itemLabels } : {}),
		}
		return Response.json(body, { headers: NO_STORE })
	} catch (err) {
		req.payload.logger?.error(`analytics: query failed for adapter "${adapterId}": ${String(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: query failed'))
	}
}
