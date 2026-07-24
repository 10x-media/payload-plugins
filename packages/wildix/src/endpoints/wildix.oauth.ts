import { GetPersonalInfoCommand, type GetPersonalInfoCommandOutput } from '@wildix/wms-api-client'
import type { CollectionSlug, Endpoint } from 'payload'
import type { WildixCredentials } from '../types'
import { buildWmsClient, staticTokenProvider } from '../utils/wildixClient'
import { buildAuthorizeUrl, DEFAULT_OAUTH_SCOPES, exchangeCode } from '../utils/wildixOAuth'
import { syncChannels, syncDevices } from '../utils/wildixSyncHandlers'

type CreateWildixOAuthOptions = {
	credentials: WildixCredentials
	/** Public base URL for OAuth redirect URIs, reachable by the PBX. */
	webhookUrl: string
	/** Base URL for /admin browser redirects, typically config.serverURL. */
	adminBaseUrl: string
	wildixUsersSlug: string
	wildixDevicesSlug: string
	wildixChannelsSlug: string
	payloadUsersSlug: string | string[]
	/** When true, multiple Payload users may link to the same Wildix account. */
	allowSharedAccount?: boolean
}

/** Redirects the authenticated Payload user to the Wildix OAuth2 authorization page. */
export const createWildixOAuthConnect = ({
	credentials,
	webhookUrl,
}: CreateWildixOAuthOptions): Endpoint => ({
	path: '/wildix/oauth/connect',
	method: 'get',
	handler: async (req) => {
		if (!req.user) {
			return Response.json({ error: 'Unauthorized' }, { status: 401 })
		}
		const clientId = credentials.clientId
		const pbxHost = credentials.pbxHost
		const scopes = credentials.scopes ?? DEFAULT_OAUTH_SCOPES
		if (!clientId || !pbxHost) {
			return Response.json({ error: 'OAuth2 clientId or pbxHost not configured' }, { status: 500 })
		}

		const nonce = crypto.randomUUID()
		await req.payload.kv.set(`wildix:oauth:nonce:${nonce}`, req.user.id as string)

		const redirectUri = `${webhookUrl}/api/wildix/oauth/callback`
		const authorizeUrl = buildAuthorizeUrl({ pbxHost, clientId, redirectUri, scopes, state: nonce })

		return Response.redirect(authorizeUrl, 302)
	},
})

/**
 * Handles the Wildix OAuth2 callback: validates the state nonce, exchanges the
 * code for tokens, resolves the authenticated colleague via GetPersonalInfo, and
 * upserts the linked wildix-users record.
 */
export const createWildixOAuthCallback = ({
	credentials,
	webhookUrl,
	adminBaseUrl,
	wildixUsersSlug,
	wildixDevicesSlug,
	wildixChannelsSlug,
	payloadUsersSlug,
	allowSharedAccount = false,
}: CreateWildixOAuthOptions): Endpoint => ({
	path: '/wildix/oauth/callback',
	method: 'get',
	handler: async (req) => {
		const adminUrl = `${adminBaseUrl}/admin`

		if (!req.url) {
			return Response.redirect(`${adminUrl}?wildix_error=missing_params`, 302)
		}

		const url = new URL(req.url)
		const error = url.searchParams.get('error')
		const code = url.searchParams.get('code')
		const state = url.searchParams.get('state')

		if (error) {
			return Response.redirect(`${adminUrl}?wildix_error=${encodeURIComponent(error)}`, 302)
		}
		if (!code || !state) {
			return Response.redirect(`${adminUrl}?wildix_error=missing_params`, 302)
		}

		const usersCollection = Array.isArray(payloadUsersSlug) ? payloadUsersSlug[0] : payloadUsersSlug
		const payloadUserId = await req.payload.kv.get<string>(`wildix:oauth:nonce:${state}`)
		await req.payload.kv.delete(`wildix:oauth:nonce:${state}`)
		if (!payloadUserId) {
			return Response.redirect(`${adminUrl}?wildix_error=invalid_state`, 302)
		}

		const { clientId, clientSecret, pbxHost } = credentials
		if (!clientId || !clientSecret || !pbxHost) {
			return Response.redirect(`${adminUrl}?wildix_error=missing_credentials`, 302)
		}

		let tokens: Awaited<ReturnType<typeof exchangeCode>>
		try {
			const redirectUri = `${webhookUrl}/api/wildix/oauth/callback`
			tokens = await exchangeCode({ pbxHost, clientId, clientSecret, code, redirectUri })
		} catch {
			return Response.redirect(`${adminUrl}?wildix_error=token_exchange_failed`, 302)
		}

		const tempClient = buildWmsClient(credentials, staticTokenProvider(tokens.access_token))

		let colleague: GetPersonalInfoCommandOutput['result']
		try {
			const response = await tempClient.send(new GetPersonalInfoCommand({}))
			colleague = response.result
		} catch {
			return Response.redirect(`${adminUrl}?wildix_error=user_fetch_failed`, 302)
		}
		if (!colleague) {
			return Response.redirect(`${adminUrl}?wildix_error=no_wildix_user`, 302)
		}

		const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

		if (!allowSharedAccount) {
			const claimedBy = await req.payload.find({
				collection: wildixUsersSlug as CollectionSlug,
				where: {
					and: [
						{ wildixId: { equals: colleague.id } },
						{ 'payloadUser.value': { not_equals: payloadUserId } },
					],
				},
				limit: 1,
				overrideAccess: true,
			})
			if (claimedBy.totalDocs > 0) {
				return Response.redirect(`${adminUrl}?wildix_error=account_already_claimed`, 302)
			}
		}

		try {
			const existing = await req.payload.find({
				collection: wildixUsersSlug as CollectionSlug,
				where: { 'payloadUser.value': { equals: payloadUserId } },
				limit: 1,
				overrideAccess: true,
			})

			const data: Record<string, unknown> = {
				wildixId: colleague.id,
				name: colleague.name,
				email: colleague.email,
				extension: colleague.extension,
				officePhone: colleague.officePhone,
				mobilePhone: colleague.mobilePhone,
				role: colleague.role,
				dialplan: colleague.dialplan,
				department: colleague.department,
				language: colleague.language,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				tokenExpiresAt,
				needsReconnect: false,
			}

			if (existing.totalDocs > 0 && existing.docs[0]) {
				await req.payload.update({
					collection: wildixUsersSlug as CollectionSlug,
					id: existing.docs[0].id as string,
					data,
					overrideAccess: true,
				})
			} else {
				await req.payload.create({
					collection: wildixUsersSlug as CollectionSlug,
					data: {
						...data,
						payloadUser: {
							relationTo: usersCollection as unknown as 'users',
							value: payloadUserId,
						},
					} as Record<string, unknown>,
					overrideAccess: true,
				})
			}
		} catch {
			return Response.redirect(`${adminUrl}?wildix_error=upsert_failed`, 302)
		}

		try {
			await syncDevices({
				payload: req.payload,
				credentials,
				token: tokens.access_token,
				wildixDevicesSlug,
				wildixUsersSlug,
				scopeToUserId: colleague.id,
			})
		} catch {}
		try {
			await syncChannels({
				payload: req.payload,
				client: tempClient,
				wildixChannelsSlug,
				wildixUsersSlug,
				scopeToUserId: colleague.id,
			})
		} catch {}

		return Response.redirect(adminUrl, 302)
	},
})
