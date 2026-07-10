import type { CollectionSlug, PayloadHandler, Where } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { buildSipgateRest, Dial } from './sipgate.rest'
import { buildSipgateRestOAuth } from './sipgateOAuthRest'

type CreateSipgateDialHandlerOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	singleUserEmail?: string
	sipgateUsersSlug?: string
}

export const createSipgateDialHandler =
	({
		credentials,
		access,
		singleUserEmail,
		sipgateUsersSlug,
	}: CreateSipgateDialHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'dial')
		if (denied) return denied

		if (!req.json) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const { callee, deviceId: bodyDeviceId, channelId: bodyChannelId } = await req.json()
		if (!callee) {
			return Response.json({ error: 'callee is required' }, { status: 400 })
		}

		if (credentials.authType === 'oauth2') {
			return handleOAuth2Dial({
				req,
				credentials,
				callee,
				bodyDeviceId,
				bodyChannelId,
				sipgateUsersSlug,
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

		const rest = buildSipgateRest(credentials)
		const response = await Dial(rest, {
			callee,
			caller: deviceId,
			callerId: credentials.callerId ?? deviceId,
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
	sipgateUsersSlug?: string
}

const handleOAuth2Dial = async ({
	req,
	credentials,
	callee,
	bodyDeviceId,
	bodyChannelId,
	sipgateUsersSlug,
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
		return Response.json(
			{ error: 'No Sipgate account connected. Authenticate via OAuth first.' },
			{ status: 400 }
		)
	}

	const accessToken = sipgateUser.accessToken as string | undefined
	const refreshToken = sipgateUser.refreshToken as string | undefined

	if (!accessToken || !refreshToken) {
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
		return Response.json({ error: 'deviceId not configured' }, { status: 500 })
	}

	const response = await Dial(rest, {
		callee,
		caller: deviceId,
		callerId: credentials.callerId ?? deviceId,
		deviceId,
		channelId,
	})

	if (!response.ok) {
		const text = await response.text()
		return Response.json({ error: 'Failed to dial', detail: text }, { status: response.status })
	}
	return Response.json({ success: true }, { status: 200 })
}
