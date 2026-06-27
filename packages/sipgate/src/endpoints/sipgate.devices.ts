import { deepMerge, type Endpoint } from 'payload'
import type { SipgateAccess } from '../utils/access'
import { checkAccess } from '../utils/access'

type CreateSipgateDevicesOptions = {
	sipgateDevicesSlug: string
	sipgateUsersSlug: string
	access?: SipgateAccess
	singleUserEmail?: string
	/** @default true */
	filterDevicesByUser?: boolean
	overrides?: Partial<Endpoint>
}

export const createSipgateDevices = ({
	sipgateDevicesSlug,
	sipgateUsersSlug,
	access,
	singleUserEmail,
	filterDevicesByUser = true,
	overrides,
}: CreateSipgateDevicesOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/devices',
		method: 'get',
		handler: async (req) => {
			const denied = await checkAccess(req, access, 'devices')
			if (denied) return denied

			// biome-ignore lint/suspicious/noExplicitAny: dynamic slugs from plugin config
			const devicesCol = sipgateDevicesSlug as any
			// biome-ignore lint/suspicious/noExplicitAny: dynamic slugs from plugin config
			const usersCol = sipgateUsersSlug as any

			let sipgateUserId: string | undefined

			if (singleUserEmail) {
				const result = await req.payload.find({
					collection: usersCol,
					where: { email: { equals: singleUserEmail } },
					limit: 1,
					overrideAccess: true,
				})
				sipgateUserId = result.docs[0]?.id as string | undefined
			} else if (filterDevicesByUser && req.user) {
				const result = await req.payload.find({
					collection: usersCol,
					where: { 'payloadUser.value': { equals: req.user.id } },
					limit: 1,
					overrideAccess: true,
				})
				sipgateUserId = result.docs[0]?.id as string | undefined
			}

			const devices = await req.payload.find({
				collection: devicesCol,
				where: sipgateUserId ? { sipgateUserId: { equals: sipgateUserId } } : undefined,
				limit: 100,
				depth: 0,
				overrideAccess: true,
			})

			return Response.json(devices.docs)
		},
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
