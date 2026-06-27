import type { PayloadRequest } from 'payload'
import type { SipgateDevice } from '../utils/sipgate.rest'
import { LiveCallFloatingWindowClient } from './LiveCallFloatingWindowClient'

const LiveCallFloatingWindow = async ({ req }: { req: PayloadRequest }) => {
	const slug = 'sipgate-devices'
	let initialDevices: SipgateDevice[] = []
	try {
		const result = await req.payload.find({
			collection: slug,
			limit: 100,
			depth: 0,
			overrideAccess: true,
		})
		initialDevices = (result.docs ?? []) as SipgateDevice[]
	} catch {}
	return <LiveCallFloatingWindowClient initialDevices={initialDevices} />
}

export default LiveCallFloatingWindow
