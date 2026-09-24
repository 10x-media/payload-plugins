import type { AuthStrategy, Payload } from 'payload'

import { absoluteExpiryCookies } from '../auth/expiryCookies'
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

	const isImpersonatorRequest = sid === row.impersonatorSid && sid !== row.targetSid
	if (!canSetHeaders) {
		return isImpersonatorRequest ? result : { user: null }
	}

	const headers = result.responseHeaders ?? new Headers()
	for (const cookie of await absoluteExpiryCookies({ options, payload, row, sid, user })) {
		headers.append('Set-Cookie', cookie)
	}
	if (isImpersonatorRequest) {
		return { ...result, responseHeaders: headers }
	}
	return { responseHeaders: headers, user: null }
}
