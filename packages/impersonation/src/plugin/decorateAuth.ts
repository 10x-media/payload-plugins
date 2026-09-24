import type { AuthStrategy, CollectionSlug, Payload, TypedUser } from 'payload'

import { expireCookie, expirePayloadCookie } from '../auth/cookies'
import { isolatedCookieNameFor } from '../auth/mode'
import { collectionBySlug } from '../ids'
import { closeAndRevoke } from '../session/close'
import { findOpenBySid, isPastAbsoluteExpiry, relationOf } from '../session/resolve'
import type {
	ImpersonatedUser,
	ImpersonationActor,
	ImpersonationRecord,
	ResolvedOptions,
} from '../types'
import { boundSid } from '../types'
import { shouldLookupImpersonation } from './lookup'

/**
 * Runtime wrap of `payload.authStrategies` (assembled in `init()`, not a config
 * field). Collection strategies run before `local-jwt` and return on the first
 * user, so decorating only a collection strategy would miss every local-jwt
 * login.
 *
 * No sid cache. A negative hit on the impersonator's sid would go stale the
 * moment they start (findOpenBySid also matches impersonatorSid). Terminate
 * must be visible on the next request, so positives stay uncached too.
 */
export const decorateAuthStrategies = (payload: Payload, options: ResolvedOptions): void => {
	payload.authStrategies = payload.authStrategies.map((strategy) =>
		wrapStrategy({ options, payload, strategy })
	)
}

const wrapStrategy = ({
	options,
	payload,
	strategy,
}: {
	options: ResolvedOptions
	payload: Payload
	strategy: AuthStrategy
}): AuthStrategy => ({
	name: strategy.name,
	authenticate: async (args) => {
		const result = await strategy.authenticate(args)
		const user = result.user as ImpersonatedUser | null
		const sid = boundSid(user, options.session.binding)
		if (!user || !sid) {
			return result
		}

		if (!shouldLookupImpersonation({ headers: args.headers, options, sid })) {
			return result
		}

		const row = await findOpenBySid({ options, payload, sid })
		if (!row) {
			return result
		}

		if (isPastAbsoluteExpiry(row)) {
			return expireAbsoluteCap({
				canSetHeaders: args.canSetHeaders,
				options,
				payload,
				result,
				row,
				sid,
				user,
			})
		}

		const impersonator = relationOf(row.impersonator)
		const target = relationOf(row.target)
		if (impersonator && target && sid === row.targetSid) {
			const actor: ImpersonationActor = {
				absoluteExpiresAt: row.absoluteExpiresAt ?? null,
				id: row.id,
				impersonator,
				impersonatorEmail: row.impersonatorEmail,
				impersonatorLocale: row.impersonatorLocale,
				mode: row.mode,
				reason: row.reason,
				startedAt: row.startedAt,
				target,
				targetEmail: row.targetEmail,
			}
			user._impersonation = actor
		}

		return result
	},
})

/**
 * Parallel expiry must not clear `${cookiePrefix}-token`. That cookie is still
 * the impersonator. Swap expiry clears it because it was overwritten on start.
 */
const expireAbsoluteCap = async ({
	canSetHeaders,
	options,
	payload,
	result,
	row,
	sid,
	user,
}: {
	canSetHeaders: boolean | undefined
	options: ResolvedOptions
	payload: Payload
	result: Awaited<ReturnType<AuthStrategy['authenticate']>>
	row: ImpersonationRecord
	sid: string
	user: ImpersonatedUser
}): Promise<Awaited<ReturnType<AuthStrategy['authenticate']>>> => {
	await closeAndRevoke({ endedBy: 'expired', options, payload, record: row })

	const impersonator = relationOf(row.impersonator)
	const target = relationOf(row.target)
	const isImpersonatorRequest = sid === row.impersonatorSid && sid !== row.targetSid
	const targetAuth = target ? collectionBySlug(payload, target.collection)?.config.auth : undefined
	const impersonatorAuth =
		(impersonator && collectionBySlug(payload, impersonator.collection)?.config.auth) ||
		collectionBySlug(payload, payload.config.admin.user)?.config.auth
	const cookieAuth = targetAuth ?? impersonatorAuth

	if (!canSetHeaders || !cookieAuth) {
		return isImpersonatorRequest ? result : { user: null }
	}

	const headers = result.responseHeaders ?? new Headers()
	headers.append(
		'Set-Cookie',
		expireCookie({ authConfig: cookieAuth, name: options.hintCookieName })
	)

	if (row.mode === 'parallel' && target && targetAuth) {
		const slotUser = await slotUserForTarget({ isImpersonatorRequest, payload, target, user })
		const isolatedName = slotUser
			? await isolatedCookieNameFor({
					collection: target.collection as CollectionSlug,
					payload,
					user: slotUser,
				})
			: undefined
		if (isolatedName) {
			headers.append('Set-Cookie', expireCookie({ authConfig: targetAuth, name: isolatedName }))
		}
		if (isImpersonatorRequest) {
			return { ...result, responseHeaders: headers }
		}
		return { responseHeaders: headers, user: null }
	}

	if (impersonatorAuth) {
		headers.append(
			'Set-Cookie',
			expirePayloadCookie({
				authConfig: impersonatorAuth,
				cookiePrefix: payload.config.cookiePrefix,
			})
		)
	}
	return { responseHeaders: headers, user: null }
}

const slotUserForTarget = async ({
	isImpersonatorRequest,
	payload,
	target,
	user,
}: {
	isImpersonatorRequest: boolean
	payload: Payload
	target: { collection: string; id: number | string }
	user: ImpersonatedUser
}): Promise<null | TypedUser> => {
	if (!isImpersonatorRequest) {
		return user
	}
	try {
		return (await payload.findByID({
			id: target.id,
			collection: target.collection as CollectionSlug,
			depth: 0,
			overrideAccess: true,
		})) as TypedUser
	} catch {
		return { collection: target.collection, id: target.id } as TypedUser
	}
}
