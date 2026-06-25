import type { PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import { createActiveCallStore } from './activeCall'
import { hangupCall, holdCall, muteCall, recordingsCall, transferCall } from './sipgate.rest'

export type SipgateRtcmAction = 'answer' | 'hold' | 'mute' | 'recordings' | 'hangup'

export const sipgateRtcmHandler =
	(_credentials: SipgateCredentials): PayloadHandler =>
	async (req) => {
		if (!req.json) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const { callId, action, deviceId } = await req.json()
		if (!callId) {
			return Response.json({ error: 'callId is required' }, { status: 400 })
		}
		if (!action) {
			return Response.json({ error: 'action is required' }, { status: 400 })
		}

		const store = createActiveCallStore(req.payload, callId)

		switch (action) {
			case 'transfer':
				if (!deviceId) {
					return Response.json(
						{ error: 'deviceId is required to transfer a call' },
						{ status: 400 }
					)
				}
				try {
					await transferCall(callId, deviceId)
				} catch {
					return Response.json({ error: 'Failed to transfer call' }, { status: 500 })
				}
				break
			case 'hold': {
				const current = await store.getOne()
				const newValue = !current?.held
				try {
					await holdCall(callId, { value: newValue })
				} catch {
					return Response.json({ error: 'Failed to hold call' }, { status: 500 })
				}
				await store.update({ held: newValue })
				break
			}
			case 'mute': {
				const current = await store.getOne()
				const newValue = !current?.muted
				try {
					await muteCall(callId, { value: newValue })
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to mute call'
					const status = msg.includes('501') ? 501 : 500
					return Response.json({ error: msg }, { status })
				}
				await store.update({ muted: newValue })
				break
			}
			case 'recordings': {
				const current = await store.getOne()
				const newValue = !current?.recording
				try {
					await recordingsCall(callId, { announcement: false, value: newValue })
				} catch {
					return Response.json({ error: 'Failed to toggle recording' }, { status: 500 })
				}
				await store.update({ recording: newValue })
				break
			}
			case 'hangup':
				try {
					await hangupCall(callId)
				} catch {
					return Response.json({ error: 'Failed to hang up call' }, { status: 500 })
				}
				await store.clear()
				return Response.json({ success: true }, { status: 200 })
			default:
				return Response.json({ error: 'Invalid action' }, { status: 400 })
		}

		const updated = await store.getOne()
		return Response.json(updated ?? { success: true }, { status: 200 })
	}
