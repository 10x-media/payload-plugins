import type { PayloadComponent, PayloadServerReactComponent } from 'payload'
import type { LiveCallPosition } from '../types'
import type { SipgateDevice } from '../utils/sipgate.rest'
import { LiveCallFloatingWindowClient } from './LiveCallFloatingWindowClient'

const USERS_SLUG = 'sipgate-users'
const DEVICES_SLUG = 'sipgate-devices'

const LiveCallFloatingWindow: PayloadServerReactComponent<PayloadComponent> = async (props) => {
	const position: LiveCallPosition =
		(props as unknown as { clientProps?: { position?: LiveCallPosition } }).clientProps?.position ??
		'bottom-right'

	let sipgateUserId: string | undefined

	if (props.user) {
		try {
			const result = await props.payload.find({
				collection: USERS_SLUG,
				where: { 'payloadUser.value': { equals: props.user.id } },
				limit: 1,
				overrideAccess: true,
			})
			sipgateUserId = result.docs[0]?.sipgateId as string
		} catch {}
	}

	let initialDevices: SipgateDevice[] = []
	try {
		const result = await props.payload.find({
			collection: DEVICES_SLUG,
			where: sipgateUserId ? { sipgateUserId: { equals: sipgateUserId } } : undefined,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = (result?.docs ?? []) as SipgateDevice[]
	} catch {}

	return <LiveCallFloatingWindowClient initialDevices={initialDevices} position={position} />
}

export default LiveCallFloatingWindow
