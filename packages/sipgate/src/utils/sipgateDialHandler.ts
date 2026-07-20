import type { CollectionSlug, Payload, PayloadHandler, Where } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { buildSipgateRest, Dial } from './sipgate.rest'
import { buildSipgateRestOAuth } from './sipgateOAuthRest'
import { toSipgateE164 } from './toSipgateE164'

type CreateSipgateDialHandlerOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	singleUserEmail?: string
	sipgateUsersSlug?: string
	sipgateChannelsSlug?: string
}

/**
 * Resolves the outbound caller ID (must be E.164 digits for Neo `/calls`).
 * Never falls back to a device ID. Priority: body → credentials → channel name.
 */
const resolveCallerId = async ({
	payload,
	bodyCallerId,
	credentialsCallerId,
	channelId,
	sipgateChannelsSlug,
}: {
	payload: Payload
	bodyCallerId?: string
	credentialsCallerId?: string
	channelId?: string
	sipgateChannelsSlug?: string
}): Promise<string | undefined> => {
	const fromBody = toSipgateE164(bodyCallerId)
	if (fromBody) return fromBody

	const fromCredentials = toSipgateE164(credentialsCallerId)
	if (fromCredentials) return fromCredentials

	if (!channelId || !sipgateChannelsSlug) return undefined

	const result = await payload.find({
		collection: sipgateChannelsSlug as CollectionSlug,
		where: { sipgateId: { equals: channelId } },
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})
	const channel = result.docs[0] as Record<string, unknown> | undefined
	return toSipgateE164(channel?.name as string | undefined)
}

export const createSipgateDialHandler =
	({
		credentials,
		access,
		singleUserEmail,
		sipgateUsersSlug,
		sipgateChannelsSlug = 'sipgate-channels',
	}: CreateSipgateDialHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'dial')
		if (denied) return denied

		if (!req.json) {
			req.payload.logger.warn('[sipgate:dial] request has no JSON body')
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const {
			callee: rawCallee,
			deviceId: bodyDeviceId,
			channelId: bodyChannelId,
			callerId: bodyCallerId,
		} = await req.json()
		req.payload.logger.debug(
			{
				hasCallee: Boolean(rawCallee),
				bodyDeviceId,
				bodyChannelId,
				hasCallerId: Boolean(bodyCallerId),
				authType: credentials.authType,
				userId: req.user?.id,
			},
			'[sipgate:dial] incoming dial request'
		)
		if (!rawCallee) {
			req.payload.logger.warn('[sipgate:dial] callee missing')
			return Response.json({ error: 'callee is required' }, { status: 400 })
		}

		const callee = toSipgateE164(rawCallee) ?? String(rawCallee).replace(/\D/g, '')
		if (!callee) {
			return Response.json({ error: 'callee is not a valid phone number' }, { status: 400 })
		}

		if (credentials.authType === 'oauth2') {
			return handleOAuth2Dial({
				req,
				credentials,
				callee,
				bodyDeviceId,
				bodyChannelId,
				bodyCallerId,
				sipgateUsersSlug,
				sipgateChannelsSlug,
			})
		}

		let deviceId: string | undefined = bodyDeviceId ?? credentials.deviceId
		let channelId: string | undefined = bodyChannelId ?? credentials.channelId

		if (sipgateUsersSlug && (!deviceId || !channelId)) {
			const lookupWhere: Where | null = singleUserEmail
				? { email: { equals: singleUserEmail } }
				: req.user
					? { 'payloadUser.value': { equals: req.user.id } }
					: null

			if (lookupWhere) {
				const result = await req.payload.find({
					collection: sipgateUsersSlug as CollectionSlug,
					where: lookupWhere,
					limit: 1,
					overrideAccess: true,
				})
				const sipgateUser = result.docs[0] as Record<string, unknown> | undefined
				if (sipgateUser) {
					deviceId ??= sipgateUser.defaultDevice as string | undefined
					channelId ??= sipgateUser.defaultChannel as string | undefined
				}
			}
		}

		if (!deviceId) {
			return Response.json({ error: 'deviceId not configured' }, { status: 500 })
		}

		if (!channelId) {
			return Response.json({ error: 'channelId not configured' }, { status: 500 })
		}

		const callerId = await resolveCallerId({
			payload: req.payload,
			bodyCallerId,
			credentialsCallerId: credentials.callerId,
			channelId,
			sipgateChannelsSlug,
		})
		if (!callerId) {
			return Response.json(
				{
					error:
						'callerId must be a valid E.164 phone number. Set sipgateCredentials.callerId, pass callerId in the dial body, or ensure the selected channel has a phone number as its name.',
				},
				{ status: 400 }
			)
		}

		const rest = buildSipgateRest(credentials)
		const response = await Dial(rest, {
			callee,
			caller: deviceId,
			callerId,
			deviceId,
			channelId,
		})

		if (!response.ok) {
			const text = await response.text()
			return Response.json({ error: 'Failed to dial', detail: text }, { status: response.status })
		}
		return Response.json({ success: true }, { status: 200 })
	}

type HandleOAuth2DialOptions = {
	req: Parameters<PayloadHandler>[0]
	credentials: SipgateCredentials
	callee: string
	bodyDeviceId?: string
	bodyChannelId?: string
	bodyCallerId?: string
	sipgateUsersSlug?: string
	sipgateChannelsSlug?: string
}

const handleOAuth2Dial = async ({
	req,
	credentials,
	callee,
	bodyDeviceId,
	bodyChannelId,
	bodyCallerId,
	sipgateUsersSlug,
	sipgateChannelsSlug,
}: HandleOAuth2DialOptions): Promise<Response> => {
	if (!req.user) {
		return Response.json({ error: 'Must be authenticated to use OAuth2 dial' }, { status: 401 })
	}

	if (!sipgateUsersSlug) {
		return Response.json({ error: 'sipgateUsersSlug required for OAuth2 dial' }, { status: 500 })
	}

	const result = await req.payload.find({
		collection: sipgateUsersSlug as CollectionSlug,
		where: { 'payloadUser.value': { equals: req.user.id } },
		limit: 1,
		overrideAccess: true,
	})

	const sipgateUser = result.docs[0] as Record<string, unknown> | undefined
	if (!sipgateUser) {
		req.payload.logger.warn(
			{ userId: req.user.id, sipgateUsersSlug },
			'[sipgate:dial] no sipgate user doc linked to payload user'
		)
		return Response.json(
			{ error: 'No Sipgate account connected. Authenticate via OAuth first.' },
			{ status: 400 }
		)
	}

	const accessToken = sipgateUser.accessToken as string | undefined
	const refreshToken = sipgateUser.refreshToken as string | undefined

	if (!accessToken || !refreshToken) {
		req.payload.logger.warn(
			{
				docId: sipgateUser.id,
				hasAccessToken: Boolean(accessToken),
				hasRefreshToken: Boolean(refreshToken),
				needsReconnect: sipgateUser.needsReconnect,
			},
			'[sipgate:dial] oauth tokens missing on sipgate user doc'
		)
		return Response.json(
			{ error: 'Sipgate OAuth tokens missing. Please reconnect.' },
			{ status: 400 }
		)
	}

	const clientId = credentials.clientId
	const clientSecret = credentials.clientSecret
	if (!clientId || !clientSecret) {
		return Response.json({ error: 'OAuth2 client credentials not configured' }, { status: 500 })
	}

	const docId = sipgateUser.id as string
	const realm = credentials.realm ?? 'third-party'

	const rest = buildSipgateRestOAuth({
		accessToken,
		refreshToken,
		clientId,
		clientSecret,
		realm,
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

	const deviceId = bodyDeviceId ?? (sipgateUser.defaultDevice as string | undefined)
	const channelId = bodyChannelId ?? (sipgateUser.defaultChannel as string | undefined)

	if (!deviceId) {
		req.payload.logger.warn(
			{ docId: sipgateUser.id, defaultDevice: sipgateUser.defaultDevice },
			'[sipgate:dial] no deviceId (body + defaultDevice both empty)'
		)
		return Response.json({ error: 'deviceId not configured' }, { status: 500 })
	}

	if (!channelId) {
		req.payload.logger.warn(
			{ docId: sipgateUser.id, defaultChannel: sipgateUser.defaultChannel },
			'[sipgate:dial] no channelId (body + defaultChannel both empty)'
		)
		return Response.json({ error: 'channelId not configured' }, { status: 500 })
	}

	const callerId = await resolveCallerId({
		payload: req.payload,
		bodyCallerId,
		credentialsCallerId: credentials.callerId,
		channelId,
		sipgateChannelsSlug,
	})
	if (!callerId) {
		return Response.json(
			{
				error:
					'callerId must be a valid E.164 phone number. Set sipgateCredentials.callerId, pass callerId in the dial body, or ensure the selected channel has a phone number as its name.',
			},
			{ status: 400 }
		)
	}

	req.payload.logger.info(
		{ callee, deviceId, channelId, callerId, realm },
		'[sipgate:dial] posting to sipgate /calls (oauth2)'
	)

	const response = await Dial(rest, {
		callee,
		caller: deviceId,
		callerId,
		deviceId,
		channelId,
	})

	if (!response.ok) {
		const text = await response.text()
		req.payload.logger.error(
			{
				status: response.status,
				statusText: response.statusText,
				detail: text,
				callee,
				deviceId,
				channelId,
				callerId,
			},
			'[sipgate:dial] sipgate /calls returned non-2xx'
		)
		return Response.json({ error: 'Failed to dial', detail: text }, { status: response.status })
	}
	req.payload.logger.info(
		{ callee, deviceId, channelId, callerId },
		'[sipgate:dial] dial succeeded'
	)
	return Response.json({ success: true }, { status: 200 })
}
