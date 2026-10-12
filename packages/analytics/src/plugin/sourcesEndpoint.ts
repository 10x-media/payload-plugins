import type { PayloadHandler, PayloadRequest } from 'payload'
import { readGate } from '../access/readGate'
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
import { resolveSourcesForRequest } from './readContextForRequest'
import { type AnalyticsRuntime, getRuntime, scopeGates } from './runtime'

/**
 * Authenticated GET listing adapters the requesting scope sees, with no scope parameter so a tenant
 * never enumerates another's. `collection` and `id` list one readable document's scope instead.
 */
export const makeSourcesHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return unauthorizedResponse()
	}
	const runtime = getRuntime(req.payload)
	try {
		return await listSources(req, runtime)
	} catch (err) {
		req.payload.logger?.error(`analytics: sources listing failed: ${String(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: sources listing failed'))
	}
}

const listSources = async (
	req: PayloadRequest,
	runtime: AnalyticsRuntime | undefined
): Promise<Response> => {
	// No runtime means the plugin served nothing to gate: the listing below is empty anyway.
	if (runtime && !(await readGate(runtime, req))) {
		return readDeniedResponse()
	}
	const params = queryParams(req)
	const collection = params.get('collection') ?? ''
	const id = params.get('id') ?? ''
	if (runtime && collection && id) {
		const bound = await resolveBoundDocument({ req, collection, id })
		if (!bound.ok) {
			return unloadedDocumentResponse(bound.status)
		}
		const gates = scopeGates(runtime, req)
		const scope = await resolveDocumentScope({ runtime, req, collection, data: bound.data, gates })
		if (!scope.ok) {
			return untrustedScopeResponse()
		}
		const listing = await resolveSourcesForRequest(req, {
			gates,
			...(scope.scope === null ? {} : { scope: scope.gated }),
		})
		return Response.json(
			{ defaultId: listing.defaultId, sources: listing.sources },
			{ headers: NO_STORE }
		)
	}
	const { sources, defaultId } = await resolveSourcesForRequest(req)
	return Response.json({ defaultId, sources }, { headers: NO_STORE })
}
