import type { CollectionSlug, Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import { getAuthorizationUserinfo, getUsers } from '../utils/sipgate.rest'
import {
	buildAuthorizeUrl,
	DEFAULT_OAUTH_SCOPES,
	exchangeCode,
	type OAuthTokens,
} from '../utils/sipgateOAuth'
import { buildSipgateRestOAuth } from '../utils/sipgateOAuthRest'
import { syncChannels, syncDevices } from '../utils/sipgateSyncHandlers'

type CreateSipgateOAuthOptions = {
	credentials: SipgateCredentials
	serverURL: string
	sipgateUsersSlug: string
	sipgateDevicesSlug: string
	sipgateChannelsSlug: string
	payloadUsersSlug: string | string[]
	/** When true, multiple Payload users may link to the same Sipgate account. */
	allowSharedSipgateAccount?: boolean
}

const noop: (tokens: OAuthTokens) => Promise<void> = async () => {}

export const createSipgateOAuthConnect = ({
	credentials,
	serverURL,
	sipgateUsersSlug: _sipgateUsersSlug,
	sipgateDevicesSlug: _sipgateDevicesSlug,
	sipgateChannelsSlug: _sipgateChannelsSlug,
	payloadUsersSlug: _payloadUsersSlug,
}: CreateSipgateOAuthOptions): Endpoint => ({
	path: '/sipgate/oauth/connect',
	method: 'get',
	handler: async (req) => {
		if (!req.user) {
			return Response.json({ error: 'Unauthorized' }, { status: 401 })
		}

		const clientId = credentials.clientId
		const realm = credentials.realm ?? 'third-party'
		const scopes = credentials.scopes ?? DEFAULT_OAUTH_SCOPES

		if (!clientId) {
			return Response.json({ error: 'OAuth2 clientId not configured' }, { status: 500 })
		}

		const redirectUri = `${serverURL}/api/sipgate/oauth/callback`
		const state = req.user.id as string
		const authorizeUrl = buildAuthorizeUrl({ clientId, realm, redirectUri, scopes, state })

		return Response.redirect(authorizeUrl, 302)
	},
})

export const createSipgateOAuthCallback = ({
	credentials,
	serverURL,
	sipgateUsersSlug,
	sipgateDevicesSlug,
	sipgateChannelsSlug,
	payloadUsersSlug,
	allowSharedSipgateAccount = false,
}: CreateSipgateOAuthOptions): Endpoint => ({
	path: '/sipgate/oauth/callback',
	method: 'get',
	handler: async (req) => {
		const adminUrl = `${serverURL}/admin`

		if (!req.url) {
			return Response.redirect(`${adminUrl}?sipgate_error=missing_params`, 302)
		}

		const url = new URL(req.url)
		const error = url.searchParams.get('error')
		const errorDescription = url.searchParams.get('error_description')
		const code = url.searchParams.get('code')
		const state = url.searchParams.get('state')

		if (error) {
			const desc = errorDescription ? encodeURIComponent(errorDescription) : error
			return Response.redirect(
				`${adminUrl}?sipgate_error=${encodeURIComponent(error)}&sipgate_error_desc=${desc}`,
				302
			)
		}

		if (!code || !state) {
			return Response.redirect(`${adminUrl}?sipgate_error=missing_params`, 302)
		}

		// Verify state is a valid Payload user ID. We can't rely on req.user here
		// because the browser session cookie may not be sent when sipgate redirects
		// back via a different hostname (e.g. ngrok in dev).
		const usersCollection = Array.isArray(payloadUsersSlug) ? payloadUsersSlug[0] : payloadUsersSlug
		try {
			const user = await req.payload.findByID({
				collection: usersCollection as Parameters<typeof req.payload.findByID>[0]['collection'],
				id: state,
				overrideAccess: true,
			})
			if (!user) throw new Error()
		} catch {
			return Response.redirect(`${adminUrl}?sipgate_error=invalid_state`, 302)
		}

		const payloadUserId = state

		const clientId = credentials.clientId
		const clientSecret = credentials.clientSecret
		const realm = credentials.realm ?? 'third-party'

		if (!clientId || !clientSecret) {
			return Response.redirect(`${adminUrl}?sipgate_error=missing_credentials`, 302)
		}

		let tokens: OAuthTokens
		try {
			const redirectUri = `${serverURL}/api/sipgate/oauth/callback`
			tokens = await exchangeCode({ clientId, clientSecret, realm, code, redirectUri })
		} catch {
			return Response.redirect(`${adminUrl}?sipgate_error=token_exchange_failed`, 302)
		}

		req.payload.logger.info({
			msg: '[sipgate oauth] token exchange ok',
			expires_in: tokens.expires_in,
		})

		const tempRest = buildSipgateRestOAuth({
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			clientId,
			clientSecret,
			realm,
			onRefresh: noop,
		})

		// GET /authorization/userinfo returns sub = the sipgate user ID (e.g. "w2").
		// Use that to find the exact user rather than falling back to getUsers()[0],
		// which is the first user in the org (typically the account owner).
		let authenticatedSub: string | undefined
		try {
			const userinfo = await getAuthorizationUserinfo(tempRest)
			req.payload.logger.info({ msg: '[sipgate oauth] /authorization/userinfo', userinfo })
			authenticatedSub = userinfo.sub
		} catch (err) {
			req.payload.logger.warn({ msg: '[sipgate oauth] /authorization/userinfo failed', err })
		}

		let sipgateUsers: Awaited<ReturnType<typeof getUsers>>
		try {
			sipgateUsers = await getUsers(tempRest)
			req.payload.logger.info({
				msg: '[sipgate oauth] getUsers',
				count: sipgateUsers.length,
				users: sipgateUsers.map((u) => ({ id: u.id, email: u.email })),
			})
		} catch {
			return Response.redirect(`${adminUrl}?sipgate_error=user_fetch_failed`, 302)
		}

		const sipgateUser = authenticatedSub
			? (sipgateUsers.find((u) => u.id === authenticatedSub) ?? sipgateUsers[0])
			: sipgateUsers[0]

		req.payload.logger.info({
			msg: '[sipgate oauth] resolved sipgate user',
			authenticatedSub,
			resolved: sipgateUser ? { id: sipgateUser.id, email: sipgateUser.email } : null,
		})

		if (!sipgateUser) {
			return Response.redirect(`${adminUrl}?sipgate_error=no_sipgate_user`, 302)
		}

		const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

		// Check whether this Sipgate account is already claimed by a different Payload user.
		if (!allowSharedSipgateAccount) {
			const claimedBy = await req.payload.find({
				collection: sipgateUsersSlug as CollectionSlug,
				where: {
					and: [
						{ sipgateId: { equals: sipgateUser.id } },
						{ 'payloadUser.value': { not_equals: payloadUserId } },
					],
				},
				limit: 1,
				overrideAccess: true,
			})
			if (claimedBy.totalDocs > 0) {
				const claimer = claimedBy.docs[0] as unknown as Record<string, unknown>
				const claimerEmail =
					typeof claimer?.email === 'string' ? encodeURIComponent(claimer.email) : ''
				return Response.redirect(
					`${adminUrl}?sipgate_error=account_already_claimed&sipgate_claimed_by=${claimerEmail}`,
					302
				)
			}
		}

		try {
			const existing = await req.payload.find({
				collection: sipgateUsersSlug as CollectionSlug,
				where: { 'payloadUser.value': { equals: payloadUserId } },
				limit: 1,
				overrideAccess: true,
			})

			if (existing.totalDocs > 0 && existing.docs[0]) {
				await req.payload.update({
					collection: sipgateUsersSlug as CollectionSlug,
					id: existing.docs[0].id as string,
					data: {
						sipgateId: sipgateUser.id,
						firstname: sipgateUser.firstname,
						lastname: sipgateUser.lastname,
						email: sipgateUser.email,
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token,
						tokenExpiresAt,
					},
					overrideAccess: true,
				})
			} else {
				await req.payload.create({
					collection: sipgateUsersSlug as CollectionSlug,
					data: {
						sipgateId: sipgateUser.id,
						firstname: sipgateUser.firstname,
						lastname: sipgateUser.lastname,
						email: sipgateUser.email,
						defaultDevice: sipgateUser.defaultDevice,
						admin: sipgateUser.admin,
						busyOnBusy: sipgateUser.busyOnBusy,
						timezone: sipgateUser.timezone,
						addressId: sipgateUser.addressId,
						payloadUser: {
							relationTo: 'users',
							value: payloadUserId,
						},
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token,
						tokenExpiresAt,
					},
					overrideAccess: true,
				})
			}
		} catch {
			return Response.redirect(`${adminUrl}?sipgate_error=upsert_failed`, 302)
		}

		// Immediately sync this user's devices and channels after connecting.
		// Errors are non-fatal — the user is already connected even if sync fails.
		try {
			await syncDevices({
				payload: req.payload,
				rest: tempRest,
				sipgateDevicesSlug,
				sipgateUsersSlug,
				scopeToUserId: sipgateUser.id,
			})
		} catch {}

		try {
			await syncChannels({
				payload: req.payload,
				rest: tempRest,
				sipgateChannelsSlug,
				sipgateUsersSlug,
				scopeToUserId: sipgateUser.id,
			})
		} catch {}

		return Response.redirect(adminUrl, 302)
	},
})
