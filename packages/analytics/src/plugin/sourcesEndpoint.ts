import type { PayloadHandler } from 'payload'
import { NO_STORE } from './errors'
import { SOURCES_PATH } from './paths'
import { resolveSourcesForRequest } from './readContextForRequest'
import { getRuntime, readAccessFor } from './runtime'

export { SOURCES_PATH }

/**
 * Authenticated GET listing the adapters visible to the requesting scope, with
 * serialized capabilities for client-side pickers. Gated by `access.read` like
 * every other read endpoint. Always answers for the caller's own resolved scope;
 * there is deliberately no scope parameter, so a tenant can never enumerate
 * another tenant's sources. Everything else about the resolution, including how a
 * null scope and a failed resolution fail closed, lives in
 * {@link resolveSourcesForRequest}, which the query endpoint shares.
 */
export const makeSourcesHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
	}
	const runtime = getRuntime(req.payload)
	// No runtime means the plugin served nothing to gate: the listing below is empty anyway.
	if (runtime && !(await readAccessFor(runtime, req))) {
		return Response.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE })
	}
	const { sources, defaultId } = await resolveSourcesForRequest(req)
	return Response.json({ defaultId, sources }, { headers: NO_STORE })
}
