import type { CollectionSlug, Endpoint } from 'payload'

import type { WikiAccessOptions } from '../options'
import { getWikiRegistry } from '../plugin/registry'
import {
	collectOrphanedTargets,
	type WikiOrphanedGuide,
	type WikiOrphansResponse,
} from '../shared/orphanedTargets'

type BuildOrphanedTargetsEndpointArgs = {
	access: Required<WikiAccessOptions>
	pagesSlug: string
}

/**
 * `GET /api/<pages>/orphaned-targets`: guides whose stored targets no longer
 * resolve against the walked config (renamed fields, removed blocks, dropped
 * collections). Restricted to update access; drafts are included because
 * unpublished guides deserve fixing too.
 */
export const buildOrphanedTargetsEndpoint = ({
	access,
	pagesSlug,
}: BuildOrphanedTargetsEndpointArgs): Endpoint => ({
	handler: async (req) => {
		const canUpdate = Boolean(await access.update({ req }))
		if (!canUpdate) {
			return Response.json({ orphans: [] satisfies WikiOrphanedGuide[] }, { status: 403 })
		}
		const registry = getWikiRegistry(req.payload.config)
		if (!registry) {
			return Response.json({ orphans: [] satisfies WikiOrphanedGuide[] })
		}
		try {
			const result = await req.payload.find({
				collection: pagesSlug as CollectionSlug,
				depth: 0,
				draft: true,
				overrideAccess: false,
				pagination: false,
				req,
				select: { slug: true, targets: true, title: true },
				user: req.user,
			})
			const body: WikiOrphansResponse = {
				orphans: collectOrphanedTargets(
					result.docs as Parameters<typeof collectOrphanedTargets>[0],
					registry.validTargetKeys
				),
			}
			return Response.json(body, { headers: { 'cache-control': 'no-store' } })
		} catch (error) {
			const status =
				typeof (error as { status?: unknown }).status === 'number'
					? (error as { status: number }).status
					: 500
			return Response.json({ orphans: [] satisfies WikiOrphanedGuide[] }, { status })
		}
	},
	method: 'get',
	path: '/orphaned-targets',
})
