import type { Payload, PayloadRequest, TypedUser } from 'payload'

import { getRegistry } from './plugin/registry'
import { isPastAbsoluteExpiry, relationOf, resolveCurrent } from './session/resolve'
import { boundSid } from './types'

export type ImpersonationStatus =
	| {
			absoluteExpiresAt: null | string
			active: true
			impersonator: { collection: string; id: number | string } | null
			impersonatorLocale: null | string
			mode: 'parallel' | 'swap'
			startedAt: string
			target: { collection: string; id: number | string } | null
	  }
	| { active: false }

const inactive = (): ImpersonationStatus => ({ active: false })

/**
 * Read the active impersonation for a request. Resolves from the database by
 * sid (and an optional hint cookie), never from `user._impersonation` alone.
 */
export async function getImpersonation(
	args: PayloadRequest | { headers: Headers; payload: Payload; user?: null | TypedUser }
): Promise<ImpersonationStatus> {
	const payload = args.payload
	const headers = args.headers
	const options = getRegistry(payload.config)
	if (!options) {
		return inactive()
	}

	let user = 'user' in args ? args.user : undefined
	if (!user) {
		;({ user } = await payload.auth({ headers }))
	}

	const sid = boundSid(user, options.session.binding)
	if (!user || !sid) {
		return inactive()
	}

	const row = await resolveCurrent({ headers, options, payload, sid })
	if (!row || isPastAbsoluteExpiry(row)) {
		return inactive()
	}

	return {
		absoluteExpiresAt: row.absoluteExpiresAt ?? null,
		active: true,
		impersonator: relationOf(row.impersonator),
		impersonatorLocale: row.impersonatorLocale ?? null,
		mode: row.mode,
		startedAt: row.startedAt,
		target: relationOf(row.target),
	}
}
