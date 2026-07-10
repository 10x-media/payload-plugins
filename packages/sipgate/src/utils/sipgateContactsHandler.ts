import type { CollectionSlug, PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { buildSipgateRest } from './sipgate.rest'
import { createSipgateContactsStore } from './sipgateContactsStore'
import { buildSipgateRestOAuth } from './sipgateOAuthRest'

type SipgateContactsHandlerOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	sipgateUsersSlug?: string
}

export const sipgateContactsHandler =
	({ credentials, access, sipgateUsersSlug }: SipgateContactsHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'contacts')
		if (denied) return denied

		let rest: ReturnType<typeof buildSipgateRest>

		if (credentials.authType === 'oauth2' && sipgateUsersSlug && req.user?.id) {
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
				return Response.json({ error: 'No sipgate account connected' }, { status: 403 })
			}

			const docId = doc.id as string
			rest = buildSipgateRestOAuth({
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
		} else {
			rest = buildSipgateRest(credentials)
		}

		const userId =
			credentials.authType === 'oauth2' ? (req.user?.id as string | undefined) : undefined
		const contactsStore = createSipgateContactsStore(req.payload, rest, userId)
		const contacts = await contactsStore.get()
		return Response.json(contacts)
	}
