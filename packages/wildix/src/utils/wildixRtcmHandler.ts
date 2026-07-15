import {
	CallControlAnswerCommand,
	CallControlAttendantTransferCommand,
	CallControlBlindTransferCommand,
	CallControlDtmfCommand,
	CallControlHangupCommand,
	CallControlHoldCommand,
	CallControlUnholdCommand,
} from '@wildix/wms-api-client'
import type { PayloadHandler } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from './access'
import { checkAccess } from './access'
import { createActiveCallStore } from './activeCall'
import { resolveWildixClient } from './resolveWildixClient'

export type WildixRtcmAction =
	| 'answer'
	| 'hold'
	| 'hangup'
	| 'transfer'
	| 'attendantTransfer'
	| 'dtmf'

type WildixRtcmHandlerOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	wildixUsersSlug?: string
}

export const wildixRtcmHandler =
	({ credentials, access, wildixUsersSlug }: WildixRtcmHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'rtcm')
		if (denied) return denied

		if (!req.json) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const { callId, action, deviceId, destination, digits } = await req.json()
		if (!callId) {
			return Response.json({ error: 'callId is required' }, { status: 400 })
		}
		if (!action) {
			return Response.json({ error: 'action is required' }, { status: 400 })
		}

		const resolved = await resolveWildixClient({ req, credentials, wildixUsersSlug })
		if ('error' in resolved) return resolved.error
		const { client, userExtension } = resolved

		const store = createActiveCallStore(req.payload, callId)

		try {
			switch (action as WildixRtcmAction) {
				case 'answer':
					await client.send(
						new CallControlAnswerCommand({
							sipCallId: callId,
							user: userExtension,
							device: deviceId,
						})
					)
					await store.update({ status: 'active' })
					break
				case 'hold': {
					const current = await store.getOne()
					const shouldHold = !current?.held
					await client.send(
						shouldHold
							? new CallControlHoldCommand({ sipCallId: callId, user: userExtension })
							: new CallControlUnholdCommand({ sipCallId: callId, user: userExtension })
					)
					await store.update({ held: shouldHold })
					break
				}
				case 'transfer':
					if (!destination) {
						return Response.json({ error: 'destination is required to transfer' }, { status: 400 })
					}
					await client.send(
						new CallControlBlindTransferCommand({
							sipCallId: callId,
							user: userExtension,
							destination,
						})
					)
					break
				case 'attendantTransfer':
					if (!destination) {
						return Response.json({ error: 'destination is required to transfer' }, { status: 400 })
					}
					await client.send(
						new CallControlAttendantTransferCommand({
							sipCallId: callId,
							user: userExtension,
							destination,
						})
					)
					break
				case 'dtmf':
					if (!digits) {
						return Response.json({ error: 'digits is required for dtmf' }, { status: 400 })
					}
					await client.send(
						new CallControlDtmfCommand({ sipCallId: callId, user: userExtension, digits })
					)
					break
				case 'hangup':
					await client.send(
						new CallControlHangupCommand({ sipCallId: callId, user: userExtension })
					)
					await store.clear()
					return Response.json({ success: true }, { status: 200 })
				default:
					return Response.json({ error: 'Invalid action' }, { status: 400 })
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err)
			req.payload.logger.error({ detail, action, callId }, '[wildix:rtcm] call control failed')
			return Response.json({ error: `Failed to ${action}`, detail }, { status: 502 })
		}

		const updated = await store.getOne()
		return Response.json(updated ?? { success: true }, { status: 200 })
	}
