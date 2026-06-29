import type { PayloadRequest } from 'payload'
import type { SipgateDevice } from '../utils/sipgate.rest'
import { LiveCallFloatingWindowClient } from './LiveCallFloatingWindowClient'

const USERS_SLUG = 'sipgate-users'
const DEVICES_SLUG = 'sipgate-devices'

const LiveCallFloatingWindow = async (props: Record<string, unknown>) => {
	console.log('[LiveCallFloatingWindow] props keys:', Object.keys(props))
	console.log('[LiveCallFloatingWindow] req:', props.req)

	const req = props.req as PayloadRequest | undefined
	let sipgateUserId: string | undefined

	if (req?.user) {
		try {
			const result = await req.payload.find({
				collection: USERS_SLUG,
				where: { 'payloadUser.value': { equals: req.user.id } },
				limit: 1,
				overrideAccess: true,
			})
			sipgateUserId = result.docs[0]?.id as string
		} catch {}
	}

	let initialDevices: SipgateDevice[] = []
	try {
		const result = await req?.payload.find({
			collection: DEVICES_SLUG,
			where: sipgateUserId ? { sipgateUserId: { equals: sipgateUserId } } : undefined,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = (result?.docs ?? []) as SipgateDevice[]
	} catch {}

	return <LiveCallFloatingWindowClient initialDevices={initialDevices} />
}

export default LiveCallFloatingWindow
