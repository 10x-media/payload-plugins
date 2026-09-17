'use client'

import type { FailureCode } from '../endpoints/codes'
import { keys } from '../translations/keys'

export type { FailureCode }

const jsonHeaders = { 'Content-Type': 'application/json' }

export const postImpersonation = async (
	path: string,
	body: unknown
): Promise<{ error?: FailureCode; ok: boolean; redirect?: string; status: number }> => {
	const response = await fetch(path, {
		body: JSON.stringify(body ?? {}),
		credentials: 'include',
		headers: jsonHeaders,
		method: 'POST',
	})
	let parsed: { error?: FailureCode; redirect?: string } = {}
	try {
		parsed = (await response.json()) as { error?: FailureCode; redirect?: string }
	} catch {
		parsed = {}
	}
	return {
		error: parsed.error,
		ok: response.ok,
		redirect: parsed.redirect,
		status: response.status,
	}
}

/** Reload when the redirect is the current path; `assign` would be a no-op. */
export const goAfterSwitch = (redirect?: string) => {
	const next = redirect ?? '/'
	const path = new URL(next, window.location.origin).pathname
	if (path === window.location.pathname) {
		window.location.reload()
		return
	}
	window.location.assign(next)
}

export const errorKey = (code: string) => {
	const map: Record<string, (typeof keys)[keyof typeof keys]> = {
		alreadyImpersonating: keys.errorAlreadyImpersonating,
		failed: keys.errorFailed,
		forbidden: keys.errorForbidden,
		impersonatorGone: keys.errorImpersonatorGone,
		impersonatorSessionExpired: keys.errorImpersonatorSessionExpired,
		invalidBody: keys.errorInvalidBody,
		notImpersonating: keys.errorNotImpersonating,
		origin: keys.errorOrigin,
		reasonRequired: keys.errorReasonRequired,
		selfTarget: keys.errorSelfTarget,
		targetNotFound: keys.errorTargetNotFound,
		targetTrashed: keys.errorTargetTrashed,
		targetUnverified: keys.errorTargetUnverified,
		unsupportedAuth: keys.errorUnsupportedAuth,
		unsupportedCollection: keys.errorUnsupportedCollection,
	}
	return map[code] ?? keys.errorFailed
}
