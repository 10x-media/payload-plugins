import type { PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import { Dial } from './sipgate.rest'

export const createSipgateDialHandler =
	(credentials: SipgateCredentials): PayloadHandler =>
	async (req) => {
		if (!req.json) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const { callee } = await req.json()
		if (!callee) {
			return Response.json({ error: 'callee is required' }, { status: 400 })
		}
		if (!credentials.deviceId) {
			return Response.json({ error: 'deviceId not configured' }, { status: 500 })
		}

		const response = await Dial({
			callee,
			caller: credentials.deviceId,
			callerId: credentials.callerId ?? credentials.deviceId,
			deviceId: credentials.deviceId,
			channelId: credentials.channelId,
		})

		if (!response.ok) {
			const text = await response.text()
			return Response.json({ error: 'Failed to dial', detail: text }, { status: response.status })
		}
		return Response.json({ success: true }, { status: 200 })
	}
