import type { PayloadHandler } from 'payload'
import { serializeCapabilities } from '../core/capabilities'
import { SOURCES_PATH } from './paths'
import { getRuntime, platformReadFor, resolveRegistryFor, resolveScopeFor } from './runtime'

export { SOURCES_PATH }

/**
 * Authenticated GET listing the adapters visible to the requesting scope, with
 * serialized capabilities for client-side pickers. Always answers for the
 * caller's own resolved scope; there is deliberately no scope parameter, so a
 * tenant can never enumerate another tenant's sources. On a scoped install, a
 * request that resolves no scope at all is ambiguous, not install-wide, so it
 * answers empty rather than leaking the static config registry, unless
 * `platformRead` grants it. On resolution failure, an unscoped install falls
 * back to the static config registry; a scoped install answers empty, since a
 * failed resolution is indistinguishable from a forged one.
 */
export const makeSourcesHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return Response.json({ error: 'unauthorized' }, { status: 401 })
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return Response.json({ defaultId: null, sources: [] })
	}
	try {
		const scope = await resolveScopeFor(runtime, req)
		if (runtime.scoped && scope === null && !(await platformReadFor(runtime, req))) {
			return Response.json({ defaultId: null, sources: [] })
		}
		const registry = await resolveRegistryFor(runtime, { payload: req.payload, req, scope })
		const sources = registry.all().map((a) => ({
			id: a.id,
			label: a.label,
			kind: runtime.configAdapterIds.has(a.id) ? ('config' as const) : ('runtime' as const),
			capabilities: serializeCapabilities(a.capabilities),
		}))
		return Response.json({ defaultId: registry.default().id, sources })
	} catch (err) {
		req.payload.logger?.warn(`analytics: sources listing failed: ${String(err)}`)
		if (runtime.scoped) {
			return Response.json({ defaultId: null, sources: [] })
		}
		const sources = runtime.registry.all().map((a) => ({
			id: a.id,
			label: a.label,
			kind: 'config' as const,
			capabilities: serializeCapabilities(a.capabilities),
		}))
		return Response.json({ defaultId: runtime.registry.default().id, sources })
	}
}
