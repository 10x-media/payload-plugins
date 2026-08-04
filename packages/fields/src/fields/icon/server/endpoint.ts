import type { PayloadRequest } from 'payload'
import type { IconAdapter, IconAvailabilityResolver } from '../../../types'
import { loadLayeredManifest } from '../layers/resolve'
import { unionAlwaysAvailable } from './availability'

/**
 * Namespaced so it cannot collide with a consumer's own routes. The slug is a path
 * parameter rather than a query so an unknown library is a 404 rather than a 200 holding
 * nothing.
 */
export const ICON_MANIFEST_PATH = '/10x-fields/icon-manifest/:slug'

const json = (body: unknown, status: number): Response =>
	new Response(JSON.stringify(body), {
		headers: {
			// A runtime-backed library changes between requests, so a browser must never
			// reuse a listing. The server-side per-layer cache is what makes that affordable.
			'Cache-Control': 'private, no-store',
			'Content-Type': 'application/json',
		},
		status,
	})

export type IconManifestHandlerArgs = {
	adapters: IconAdapter[]
	alwaysAvailable?: string[]
	resolveAvailable?: IconAvailabilityResolver
}

/**
 * Serves a library's merged manifest to the admin drawer.
 *
 * This exists so a layer whose data lives on the server is written once, server-side, with
 * `req` in hand. Without it every consumer with a database-backed library would hand-roll
 * an endpoint and invent their own auth and caching story.
 */
export const createIconManifestHandler =
	(args: IconManifestHandlerArgs) =>
	async (req: PayloadRequest): Promise<Response> => {
		if (!req.user) return json({ message: 'Forbidden' }, 403)
		const slug = String((req.routeParams as { slug?: unknown } | undefined)?.slug ?? '')
		const adapter = args.adapters.find((candidate) => candidate.slug === slug)
		if (!adapter) return json({ message: `Unknown icon library: ${slug}` }, 404)

		// Availability gates every other surface, so the endpoint honours the same rule,
		// including the alwaysAvailable union. Skipping that union would leave a globally
		// offered library pickable in the field and unreachable here.
		const always = unionAlwaysAvailable(args.alwaysAvailable, undefined)
		const resolved = args.resolveAvailable
			? await args.resolveAvailable({ req, data: undefined, siblingData: undefined })
			: args.adapters.map((candidate) => candidate.slug)
		const available = new Set([...resolved, ...always])
		if (!available.has(slug)) return json({ message: 'Forbidden' }, 403)

		try {
			const manifest = await loadLayeredManifest(adapter, { payload: req.payload, req })
			return json(manifest, 200)
		} catch (error) {
			req.payload?.logger?.error?.({
				err: error,
				msg: `[fields] icon manifest failed for library "${slug}"`,
			})
			// A failed layer must not read as an empty library: the drawer would show "no
			// icons found" and an editor would believe the library was empty.
			return json({ message: 'Failed to load icon manifest' }, 500)
		}
	}
