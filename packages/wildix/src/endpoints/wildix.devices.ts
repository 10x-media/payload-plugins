import { type CollectionSlug, deepMerge, type Endpoint, type Where } from 'payload'
import type { WildixAccess } from '../utils/access'
import { checkAccess } from '../utils/access'

type CreateWildixDevicesOptions = {
	wildixDevicesSlug: string
	wildixUsersSlug: string
	access?: WildixAccess
	overrides?: Partial<Endpoint>
}

/**
 * Returns synced devices. When `?user=me` is passed and the caller has a linked
 * Wildix account, results are scoped to that user's devices.
 */
export const createWildixDevices = ({
	wildixDevicesSlug,
	wildixUsersSlug,
	access,
	overrides,
}: CreateWildixDevicesOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/devices',
		method: 'get',
		handler: async (req) => {
			const denied = await checkAccess(req, access, 'devices')
			if (denied) return denied

			const scope = req.url ? new URL(req.url).searchParams.get('user') : null
			let where: Where | undefined

			if (scope === 'me' && req.user) {
				const linked = await req.payload.find({
					collection: wildixUsersSlug as CollectionSlug,
					where: { 'payloadUser.value': { equals: req.user.id } },
					limit: 1,
					depth: 0,
					overrideAccess: true,
				})
				const wildixId = (linked.docs[0] as Record<string, unknown> | undefined)?.wildixId as
					| string
					| undefined
				if (!wildixId) return Response.json({ devices: [] }, { status: 200 })
				where = { wildixUserId: { equals: wildixId } }
			}

			const result = await req.payload.find({
				collection: wildixDevicesSlug as CollectionSlug,
				where,
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})

			return Response.json({ devices: result.docs }, { status: 200 })
		},
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
