import type { PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { createActiveCallStore } from './activeCall'
import {
	buildSipgateRest,
	hangupCall,
	holdCall,
	muteCall,
	recordingsCall,
	transferCall,
} from './sipgate.rest'

export type SipgateRtcmAction = 'answer' | 'hold' | 'mute' | 'recordings' | 'hangup'

export const sipgateRtcmHandler =
	(credentials: SipgateCredentials, access?: SipgateAccess): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'rtcm')
		if (denied) return denied

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

		const rest = buildSipgateRest(credentials)
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
					await transferCall(rest, callId, deviceId)
				} catch {
					return Response.json({ error: 'Failed to transfer call' }, { status: 500 })
				}
				break
			case 'hold': {
				const current = await store.getOne()
				const newValue = !current?.held
				try {
					await holdCall(rest, callId, { value: newValue })
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
					await muteCall(rest, callId, { value: newValue })
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
					await recordingsCall(rest, callId, { announcement: false, value: newValue })
				} catch {
					return Response.json({ error: 'Failed to toggle recording' }, { status: 500 })
				}
				await store.update({ recording: newValue })
				break
			}
			case 'hangup':
				try {
					await hangupCall(rest, callId)
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
