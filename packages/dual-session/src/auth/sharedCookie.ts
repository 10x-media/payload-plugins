import type { AuthStrategyFunctionArgs, AuthStrategyResult, Payload, TypedUser } from 'payload'
import { parseCookies } from 'payload/shared'

import { readCollectionClaim, withoutCookie } from '../scope/staleSharedToken'
import type { ResolvedIsolatedCollection } from '../types'
import { getSharedCookieName } from './cookies'

type Authenticate = (args: AuthStrategyFunctionArgs) => Promise<AuthStrategyResult>

const LOCAL_JWT = 'local-jwt'

/**
 * Wraps core's `local-jwt` so the shared `${cookiePrefix}-token` only ever authenticates
 * sessions that belong there.
 *
 * `local-jwt` is always last in the chain, reads no scope, and loads the user from whatever
 * collection the token names. So when an isolated strategy returns no user, the request falls
 * through to it, and a token of an isolated collection sitting in the shared cookie (a session
 * from before the plugin was deployed, a GraphQL `login`, a third-party `generatePayloadCookie`)
 * authenticates in every scope, admin included.
 *
 * A strategy can only answer for itself, never veto the rest of the chain, so the fix is to
 * hand `local-jwt` the request as if that cookie were not there:
 *
 * - a token of a collection isolated whole is recognised from its `collection` claim alone;
 * - a token of a role-split collection is only stale when `isolate` claims its user, which
 *   takes the user `local-jwt` just loaded. The admins of that collection are untouched.
 *
 * Everything else `local-jwt` does is kept, because it is still core doing it: an
 * `Authorization` header is still read in `jwtOrder`, and `autoLogin` still applies.
 *
 * Payload assembles `payload.authStrategies` before `onInit`, so this runs from there. An
 * init with `disableOnInit` skips it, and the shared cookie then behaves as in core.
 */
export const guardSharedCookie = ({
	entries,
	payload,
}: {
	entries: ResolvedIsolatedCollection[]
	payload: Payload
}): void => {
	const index = payload.authStrategies.findIndex(({ name }) => name === LOCAL_JWT)
	const original = payload.authStrategies[index]

	if (!original) {
		return
	}

	const sharedName = getSharedCookieName(payload.config.cookiePrefix)
	const isolatedWhole = new Set(entries.filter(({ isolate }) => !isolate).map(({ slug }) => slug))
	const roleSplit = new Map(
		entries.flatMap(({ isolate, slug }) => (isolate ? [[slug, isolate] as const] : []))
	)

	const authenticate = original.authenticate as Authenticate

	const guarded: Authenticate = async (args) => {
		const token = parseCookies(args.headers).get(sharedName)
		const collection = token ? readCollectionClaim(token) : undefined

		if (!collection) {
			return authenticate(args)
		}

		const withoutShared = () =>
			authenticate({ ...args, headers: withoutCookie(args.headers, sharedName) })

		if (isolatedWhole.has(collection)) {
			return withoutShared()
		}

		const isolate = roleSplit.get(collection)

		if (!isolate) {
			return authenticate(args)
		}

		const result = await authenticate(args)
		const user = result.user as (TypedUser & { collection?: string }) | null

		// Re-run without the cookie rather than answer null: an `Authorization` header (or
		// `autoLogin`) on the same request still deserves its turn. When the header carried
		// this same user, the re-run simply finds them again.
		if (user && user.collection === collection && isolate(user)) {
			return withoutShared()
		}

		return result
	}

	payload.authStrategies[index] = { ...original, authenticate: guarded }
}
