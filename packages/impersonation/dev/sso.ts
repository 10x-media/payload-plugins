import {
	type AuthStrategy,
	type CollectionSlug,
	type Endpoint,
	getFieldsToSign,
	jwtSign,
	type Payload,
} from 'payload'
import { generatePayloadCookie } from 'payload/shared'

const COLLECTION = 'sso-users' as CollectionSlug

/** Header the callback proves identity with. A real provider proves it with an OAuth code. */
const SSO_EMAIL_HEADER = 'x-dev-sso-email'

type SessionUser = {
	_sid?: string
	_strategy?: string
	collection: string
	email: string
	id: number | string
	sessions?: { createdAt: string; expiresAt: string; id: string }[]
}

const mintSession = (payload: Payload, user: SessionUser) => {
	const auth = payload.collections[COLLECTION]?.config.auth

	if (!auth?.useSessions) {
		return { sessions: user.sessions, sid: undefined }
	}

	const now = new Date()
	const sid = crypto.randomUUID()
	const live = (user.sessions ?? []).filter(({ expiresAt }) => new Date(expiresAt) > now)

	return {
		sid,
		sessions: [
			...live,
			{
				createdAt: now.toISOString(),
				expiresAt: new Date(now.getTime() + auth.tokenExpiration * 1000).toISOString(),
				id: sid,
			},
		],
	}
}

/**
 * Stand-in SSO strategy for the disableLocalStrategy collection. Identity comes
 * from a header; the callback below writes the shared cookie. When impersonation
 * grows session seams, this is the collection they attach to.
 */
export const devSsoStrategy: AuthStrategy = {
	name: 'dev-sso',
	authenticate: async ({ headers, payload }) => {
		const email = headers.get(SSO_EMAIL_HEADER)

		if (!email) {
			return { user: null }
		}

		const found = (
			await payload.find({
				collection: COLLECTION,
				limit: 1,
				pagination: false,
				showHiddenFields: true,
				where: { email: { equals: email } },
			})
		).docs[0] as unknown as SessionUser | undefined

		if (!found) {
			return { user: null }
		}

		const { sessions, sid } = mintSession(payload, found)

		if (sid) {
			await payload.db.updateOne({
				id: found.id,
				collection: COLLECTION,
				data: { sessions },
				req: undefined,
				returning: false,
			})
		}

		return {
			user: { ...found, _sid: sid, _strategy: 'dev-sso', collection: COLLECTION, sessions },
		} as never
	},
}

export const devSsoCallback: Endpoint = {
	method: 'get',
	path: '/sso/callback',
	handler: async (req) => {
		const url = new URL(req.url ?? 'http://localhost')
		const email = url.searchParams.get('email')
		const collection = req.payload.collections[COLLECTION]

		if (!collection) {
			return Response.json({ message: 'sso-users is not registered' }, { status: 500 })
		}

		const { user } = await req.payload.auth({
			headers: new Headers(email ? { [SSO_EMAIL_HEADER]: email } : {}),
		})

		if (!user) {
			return Response.json({ message: 'sso failed' }, { status: 401 })
		}

		const authenticated = user as unknown as SessionUser
		const { token } = await jwtSign({
			fieldsToSign: getFieldsToSign({
				collectionConfig: collection.config,
				email: authenticated.email,
				sid: authenticated._sid,
				user: user as never,
			}),
			secret: req.payload.secret,
			tokenExpiration: collection.config.auth.tokenExpiration,
		})

		const headers = new Headers({ Location: '/' })
		headers.append(
			'Set-Cookie',
			generatePayloadCookie({
				collectionAuthConfig: collection.config.auth,
				cookiePrefix: req.payload.config.cookiePrefix ?? 'payload',
				token: token as string,
			})
		)

		return new Response(null, { headers, status: 302 })
	},
}
