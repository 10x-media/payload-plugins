import { jwtVerify } from 'jose'
import {
	type AuthStrategyResult,
	type CollectionSlug,
	JWT_AUTH_VERSION,
	type Payload,
} from 'payload'
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
	collection: string
	id: number | string
	sid?: string
}

/** Mirrors core's `getJWTAuthenticationReference`: a token without these shapes is refused. */
const toClaims = (claims: Record<string, unknown>): null | TokenClaims => {
	const { id, collection, sid } = claims

	if (
		typeof collection !== 'string' ||
		(typeof id !== 'number' && typeof id !== 'string') ||
		(sid !== undefined && typeof sid !== 'string')
	) {
		return null
	}

	return { id, collection, ...(sid ? { sid } : {}) }
}

/**
 * Verifies a token the way core's JWT strategy does: against every secret in the keyring
 * (the active one first, then `previousSecrets`, so tokens survive a secret rotation),
 * and only when its protected header carries Payload's current `authVersion`.
 *
 * @throws when no key verifies the token, its header is not Payload's, or its claims are malformed.
 */
const verifyToken = async ({
	payload,
	token,
}: {
	payload: Payload
	token: string
}): Promise<TokenClaims> => {
	let lastError: unknown = new Error('No secret in the keyring verified the token.')

	for (const key of payload.encryptionKeyring.all) {
		try {
			const { payload: decoded, protectedHeader } = await jwtVerify(
				token,
				new TextEncoder().encode(key.legacyKey)
			)

			if (protectedHeader.authVersion !== JWT_AUTH_VERSION) {
				throw new Error('Invalid JWT protected header')
			}

			const claims = toClaims(decoded)
			if (!claims) {
				throw new Error('Invalid JWT authentication reference')
			}

			return claims
		} catch (error) {
			lastError = error
		}
	}

	throw lastError
}

/**
 * True when `cookieName` holds a signature-valid token minted for `collectionSlug`.
 *
 * Deliberately stops at the signature and the `collection` claim, with no database read.
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
 * exactly like a normal auth collection. It just reads a different cookie.
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
	 * the order collections appear in the config, which is not a meaningful priority,
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
		authenticate: async ({ headers, isGraphQL = false, payload, req, strategyName }) => {
			const token = parseCookies(headers).get(cookieName)

			// Nothing to do, and importantly this also stops this strategy from ever
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
				// The proxy told us what this request is, so trust it.
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

			// `findByID` with `req` leaves its locale and depth on the request; core's JWT strategy
			// puts them back afterwards, and so does this one.
			const requestFallbackLocale = req?.fallbackLocale
			const requestLocale = req?.locale
			const requestDepth = req?.query?.depth

			try {
				const claims = await verifyToken({ payload, token })

				// The token must belong to this collection. Guards against a token minted
				// for another collection being replayed into this cookie.
				if (claims.collection !== slug || !claims.id) {
					return NO_USER
				}

				const collection = payload.collections[slug]
				if (!collection?.config.auth || collection.config.auth.disableLocalStrategy) {
					return NO_USER
				}

				// Same lookup as core's JWT strategy: the token already proves who this is, so
				// the user's own read access must not hide them (Payload 4's Local API no longer
				// overrides access by default), and the document is read in the request's locale.
				const user = (await payload.findByID({
					id: claims.id,
					collection: slug,
					depth: isGraphQL ? 0 : collection.config.auth.depth,
					fallbackLocale: requestFallbackLocale,
					locale: requestLocale,
					overrideAccess: true,
					req,
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
			} finally {
				if (req) {
					req.fallbackLocale = requestFallbackLocale
					req.locale = requestLocale
					if (req.query) {
						req.query.depth = requestDepth
					}
				}
			}
		},
	}
}
