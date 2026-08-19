import { jwtVerify } from 'jose'
import type { AuthStrategyResult, CollectionSlug, Payload } from 'payload'
import { parseCookies } from 'payload/shared'
import type { AuthScope, AuthStrategy } from '../types'
import { hasPrecedingAuthorization } from './authorization'
import { getSharedCookieName } from './cookies'
import { isCookieAuthAllowed } from './csrf'

const NO_USER: AuthStrategyResult = { user: null }

type AuthenticatedUser = NonNullable<AuthStrategyResult['user']>

/**
 * Fields Payload sets on the authenticated user that are not part of the generated
 * user type but are read by core (`_sid` by `refreshOperation`, `_verified` by the
 * JWT strategy).
 */
type UserWithSession = AuthenticatedUser & {
	_sid?: string
	_verified?: boolean
	sessions?: { id: string }[]
}

type TokenClaims = {
	collection?: string
	id?: number | string
	sid?: string
}

const verifyToken = async ({ payload, token }: { payload: Payload; token: string }) => {
	const secretKey = new TextEncoder().encode(payload.secret)
	const { payload: claims } = await jwtVerify<TokenClaims>(token, secretKey)
	return claims
}

/**
 * True when `cookieName` holds a signature-valid token minted for `collectionSlug`.
 *
 * Deliberately stops at the signature and the `collection` claim — no database read.
 * This only ever decides *which* session takes precedence; the winning strategy still
 * does the full lookup, so a token for a deleted user resolves to no user rather than
 * to the wrong one.
 */
const hasValidSessionCookie = async ({
	collectionSlug,
	cookieName,
	headers,
	payload,
}: {
	collectionSlug: string
	cookieName: string
	headers: Headers
	payload: Payload
}) => {
	const token = parseCookies(headers).get(cookieName)
	if (!token) {
		return false
	}

	try {
		const claims = await verifyToken({ payload, token })
		return claims.collection === collectionSlug
	} catch {
		return false
	}
}

/**
 * Authenticates a request against a collection-scoped cookie instead of the shared
 * `${cookiePrefix}-token`. Mirrors Payload's built-in JWT strategy (verification,
 * email verification gate, session `sid` check) so an isolated collection behaves
 * exactly like a normal auth collection — it just reads a different cookie.
 */
export const createIsolatedAuthStrategy = ({
	adminSessionPriority,
	cookieName,
	higherPriority,
	scopeHeader,
	scopes,
	slug,
}: {
	adminSessionPriority: boolean
	cookieName: string
	/**
	 * Isolated collections ranked above this one. Payload builds its strategy chain from
	 * the order collections appear in the config, which is not a meaningful priority —
	 * so when a visitor holds sessions for several isolated collections at once, this
	 * decides which one wins, independently of config order.
	 */
	higherPriority: { cookieName: string; slug: CollectionSlug }[]
	scopeHeader: string
	scopes: AuthScope[]
	slug: CollectionSlug
}): AuthStrategy => {
	const name = `${slug}-dual-session`

	return {
		name,
		authenticate: async ({ headers, isGraphQL = false, payload, strategyName }) => {
			const token = parseCookies(headers).get(cookieName)

			// Nothing to do — importantly this also stops this strategy from ever
			// interfering with requests that only carry the admin cookie.
			if (!token) {
				return NO_USER
			}

			if (hasPrecedingAuthorization({ headers, payload, slug })) {
				return NO_USER
			}

			if (!isCookieAuthAllowed({ headers, payload })) {
				return NO_USER
			}

			for (const higher of higherPriority) {
				const outranked = await hasValidSessionCookie({
					collectionSlug: higher.slug,
					cookieName: higher.cookieName,
					headers,
					payload,
				})

				if (outranked) {
					return NO_USER
				}
			}

			const scope = headers.get(scopeHeader)

			if (scope) {
				// The proxy told us what this request is — trust it.
				if (!scopes.includes(scope as AuthScope)) {
					return NO_USER
				}
			} else if (
				adminSessionPriority &&
				(await hasValidSessionCookie({
					collectionSlug: payload.config.admin.user,
					cookieName: getSharedCookieName(payload.config.cookiePrefix),
					headers,
					payload,
				}))
			) {
				// No proxy installed. Never let a frontend session shadow a live admin
				// session, or the admin panel becomes unreachable.
				return NO_USER
			}

			try {
				const claims = await verifyToken({ payload, token })

				// The token must belong to this collection. Guards against a token minted
				// for another collection being replayed into this cookie.
				if (claims.collection !== slug || !claims.id) {
					return NO_USER
				}

				const collection = payload.collections[slug]
				if (!collection) {
					return NO_USER
				}

				const user = (await payload.findByID({
					id: claims.id,
					collection: slug,
					depth: isGraphQL ? 0 : collection.config.auth.depth,
				})) as UserWithSession | null

				if (!user) {
					return NO_USER
				}
				if (collection.config.auth.verify && !user._verified) {
					return NO_USER
				}

				if (collection.config.auth.useSessions) {
					const session = (user.sessions ?? []).find(({ id }) => id === claims.sid)
					if (!session || !claims.sid) {
						return NO_USER
					}
					user._sid = claims.sid
				}

				user.collection = slug as UserWithSession['collection']
				user._strategy = strategyName ?? name

				return { user }
			} catch {
				return NO_USER
			}
		},
	}
}
