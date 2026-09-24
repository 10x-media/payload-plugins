import type { Payload, PayloadRequest, TypedUser } from 'payload'

import { absoluteExpiryCookies } from './auth/expiryCookies'
import { getRegistry } from './plugin/registry'
import { closeAndRevoke } from './session/close'
import {
	impersonationSide,
	isPastAbsoluteExpiry,
	relationOf,
	resolveCurrent,
} from './session/resolve'
import type { ImpersonationRecord } from './types'
import { boundSid } from './types'

export type ImpersonationStatus =
	| {
			absoluteExpiresAt: null | string
			active: true
			impersonator: { collection: string; id: number | string } | null
			impersonatorLocale: null | string
			mode: 'parallel' | 'swap'
			side: 'impersonator' | 'target'
			startedAt: string
			target: { collection: string; id: number | string } | null
	  }
	| { active: false }

const inactive = (): ImpersonationStatus => ({ active: false })

export const statusFromRow = (row: ImpersonationRecord, sid: string): ImpersonationStatus => ({
	absoluteExpiresAt: row.absoluteExpiresAt ?? null,
	active: true,
	impersonator: relationOf(row.impersonator),
	impersonatorLocale: row.impersonatorLocale ?? null,
	mode: row.mode,
	side: impersonationSide(row, sid),
	startedAt: row.startedAt,
	target: relationOf(row.target),
})

/**
 * Active impersonation for this request, if any.
 *
 * Pass `user` when you already called `payload.auth`, so this helper does not
 * authenticate again. Omit `user` to authenticate from `headers`. Pass
 * `user: null` when you already know the request is anonymous; that skips auth
 * and returns `{ active: false }`.
 *
 * `side` is `target` when this request is the impersonated session, and
 * `impersonator` when it is the admin side of a parallel session.
 *
 * Frontend (RSC):
 *
 * ```ts
 * const { user } = await payload.auth({ headers })
 * const impersonation = await getImpersonation({ headers, payload, user })
 * ```
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

	const user = 'user' in args ? args.user : (await payload.auth({ headers })).user

	const sid = boundSid(user, options.session.binding)
	if (!user || !sid) {
		return inactive()
	}

	const row = await resolveCurrent({ headers, options, payload, sid })
	if (!row) {
		return inactive()
	}
	if (isPastAbsoluteExpiry(row)) {
		await closeAndRevoke({ endedBy: 'expired', options, payload, record: row })
		if ('payloadAPI' in args && user) {
			const cookies = await absoluteExpiryCookies({ options, payload, row, sid, user })
			args.responseHeaders ??= new Headers()
			for (const cookie of cookies) {
				args.responseHeaders.append('Set-Cookie', cookie)
			}
		}
		return inactive()
	}

	return statusFromRow(row, sid)
}
