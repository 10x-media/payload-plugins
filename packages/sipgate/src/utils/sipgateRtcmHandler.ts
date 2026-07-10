import type { CollectionSlug, PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { createActiveCallStore } from './activeCall'
import type { SipgateRestFetch } from './sipgate.rest'
import {
	answerCall,
	buildSipgateRest,
	hangupCall,
	holdCall,
	muteCall,
	recordingsCall,
	transferCall,
} from './sipgate.rest'
import { buildSipgateRestOAuth } from './sipgateOAuthRest'

export type SipgateRtcmAction = 'answer' | 'hold' | 'mute' | 'recordings' | 'hangup'

type SipgateRtcmHandlerOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	sipgateUsersSlug?: string
}

const resolveRest = async ({
	credentials,
	sipgateUsersSlug,
	req,
}: Pick<SipgateRtcmHandlerOptions, 'credentials' | 'sipgateUsersSlug'> & {
	req: Parameters<PayloadHandler>[0]
}): Promise<{ rest: SipgateRestFetch } | { error: Response }> => {
	if (credentials.authType !== 'oauth2') {
		return { rest: buildSipgateRest(credentials) }
	}

	if (!sipgateUsersSlug || !req.user?.id) {
		return {
			error: Response.json({ error: 'No sipgate account connected' }, { status: 403 }),
		}
	}

	const linked = await req.payload.find({
		collection: sipgateUsersSlug as CollectionSlug,
		where: { 'payloadUser.value': { equals: req.user.id } },
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})

	const doc = linked.docs[0] as Record<string, unknown> | undefined
	const accessToken = doc?.accessToken as string | undefined
	const refreshToken = doc?.refreshToken as string | undefined

	if (!doc || !accessToken || !refreshToken) {
		return {
			error: Response.json({ error: 'No sipgate account connected' }, { status: 403 }),
		}
	}

	const docId = doc.id as string
	const rest = buildSipgateRestOAuth({
		accessToken,
		refreshToken,
		clientId: credentials.clientId ?? '',
		clientSecret: credentials.clientSecret ?? '',
		realm: credentials.realm ?? 'third-party',
		onRefresh: async (tokens) => {
			await req.payload.update({
				collection: sipgateUsersSlug as CollectionSlug,
				id: docId,
				data: {
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
					tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
				},
				overrideAccess: true,
			})
		},
		onRefreshFailed: async () => {
			await req.payload.update({
				collection: sipgateUsersSlug as CollectionSlug,
				id: docId,
				data: { needsReconnect: true } as Record<string, unknown>,
				overrideAccess: true,
			})
		},
	})

	return { rest }
}

export const sipgateRtcmHandler =
	({ credentials, access, sipgateUsersSlug }: SipgateRtcmHandlerOptions): PayloadHandler =>
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

		const resolved = await resolveRest({ credentials, sipgateUsersSlug, req })
		if ('error' in resolved) return resolved.error
		const { rest } = resolved

		const store = createActiveCallStore(req.payload, callId)

		switch (action) {
			case 'answer':
				if (!deviceId) {
					return Response.json({ error: 'deviceId is required to answer a call' }, { status: 400 })
				}
				try {
					await answerCall(rest, callId, deviceId)
				} catch {
					return Response.json({ error: 'Failed to answer call' }, { status: 500 })
				}
				await store.update({ status: 'active' })
				break
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
