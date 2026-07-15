import type { PayloadComponent, PayloadServerReactComponent } from 'payload'
import type { LiveCallPosition } from '../types'
import { LiveCallFloatingWindowClient } from './LiveCallFloatingWindowClient'

const USERS_SLUG = 'wildix-users'
const DEVICES_SLUG = 'wildix-devices'

type WildixDevice = {
	contact: string
	userAgent: string
	online: boolean
	isActiveDevice: boolean
}

const LiveCallFloatingWindow: PayloadServerReactComponent<PayloadComponent> = async (props) => {
	const position: LiveCallPosition =
		(props as unknown as { clientProps?: { position?: LiveCallPosition } }).clientProps?.position ??
		'bottom-right'

	let wildixId: string | undefined

	if (props.user) {
		try {
			const result = await props.payload.find({
				collection: USERS_SLUG,
				where: { 'payloadUser.value': { equals: props.user.id } },
				limit: 1,
				overrideAccess: true,
			})
			wildixId = result.docs[0]?.wildixId as string | undefined
		} catch {}
	}

	let initialDevices: WildixDevice[] = []
	try {
		const result = await props.payload.find({
			collection: DEVICES_SLUG,
			where: wildixId ? { wildixUserId: { equals: wildixId } } : undefined,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = (result?.docs ?? []) as unknown as WildixDevice[]
	} catch {}

	return <LiveCallFloatingWindowClient initialDevices={initialDevices} position={position} />
}

export default LiveCallFloatingWindow
