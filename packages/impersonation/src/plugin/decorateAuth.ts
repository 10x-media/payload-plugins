import type { AuthStrategy, Payload } from 'payload'

import { expireCookie, expirePayloadCookie } from '../auth/cookies'
import { collectionBySlug } from '../ids'
import { closeAndRevoke } from '../session/close'
import { findOpenBySid, isPastAbsoluteExpiry, relationOf } from '../session/resolve'
import type { ImpersonatedUser, ImpersonationActor, ResolvedOptions } from '../types'
import { boundSid } from '../types'

/**
 * Runtime wrap of `payload.authStrategies` (assembled in `init()`, not a config
 * field). Collection strategies run before `local-jwt` and return on the first
 * user, so decorating only a collection strategy would miss every local-jwt
 * login.
 *
 * Negative-only cache: a minted sid does not exist before its row, so "no open
 * row for this sid" cannot go stale. Positive hits are never cached so terminate
 * is visible on the next request.
 */
export const decorateAuthStrategies = (payload: Payload, options: ResolvedOptions): void => {
	const negative = new Set<string>()

	payload.authStrategies = payload.authStrategies.map((strategy) =>
		wrapStrategy({ negative, options, payload, strategy })
	)
}

const wrapStrategy = ({
	negative,
	options,
	payload,
	strategy,
}: {
	negative: Set<string>
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

		if (negative.has(sid)) {
			return result
		}

		const row = await findOpenBySid({ options, payload, sid })
		if (!row) {
			negative.add(sid)
			return result
		}

		if (isPastAbsoluteExpiry(row)) {
			await closeAndRevoke({ endedBy: 'expired', options, payload, record: row })
			const impersonator = relationOf(row.impersonator)
			const authConfig =
				(impersonator && collectionBySlug(payload, impersonator.collection)?.config.auth) ||
				collectionBySlug(payload, payload.config.admin.user)?.config.auth
			if (args.canSetHeaders && authConfig) {
				const headers = result.responseHeaders ?? new Headers()
				headers.append(
					'Set-Cookie',
					expirePayloadCookie({
						authConfig,
						cookiePrefix: payload.config.cookiePrefix,
					})
				)
				headers.append('Set-Cookie', expireCookie({ authConfig, name: options.hintCookieName }))
				return { responseHeaders: headers, user: null }
			}
			return { user: null }
		}

		const impersonator = relationOf(row.impersonator)
		if (impersonator) {
			const actor: ImpersonationActor = {
				id: row.id,
				impersonator,
				mode: row.mode,
				reason: row.reason,
				startedAt: row.startedAt,
			}
			user._impersonation = actor
		}

		return result
	},
})
