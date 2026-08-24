import type { PayloadHandler } from 'payload'
import { serializeCapabilities } from '../core/capabilities'
import { SOURCES_PATH } from './paths'
import { getRuntime, resolveRegistryFor, resolveScopeFor } from './runtime'

export { SOURCES_PATH }

/**
 * Authenticated GET listing the adapters visible to the requesting scope, with
 * serialized capabilities for client-side pickers. Always answers for the
 * caller's own resolved scope; there is deliberately no scope parameter, so a
 * tenant can never enumerate another tenant's sources. Resolution failures
 * degrade to the static config registry the same way reads do.
 */
export const makeSourcesHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return Response.json({ error: 'unauthorized' }, { status: 401 })
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return Response.json({ sources: [] })
	}
	try {
		const scope = await resolveScopeFor(runtime, req)
		const registry = await resolveRegistryFor(runtime, { payload: req.payload, req, scope })
		const sources = registry.all().map((a) => ({
			id: a.id,
			label: a.label,
			capabilities: serializeCapabilities(a.capabilities),
		}))
		return Response.json({ sources })
	} catch (err) {
		req.payload.logger?.warn(`analytics: sources listing failed: ${String(err)}`)
		const sources = runtime.registry.all().map((a) => ({
			id: a.id,
			label: a.label,
			capabilities: serializeCapabilities(a.capabilities),
		}))
		return Response.json({ sources })
	}
}
