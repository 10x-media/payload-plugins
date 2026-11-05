'use client'

import type { FailureCode } from '../endpoints/codes'
import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'

export { errorKey } from '../translations/errorKey'
export type { FailureCode }

const jsonHeaders = { 'Content-Type': 'application/json' }

export const postImpersonation = async (
	path: string,
	body: unknown
): Promise<{ error?: FailureCode; ok: boolean; redirect?: string; status: number }> => {
	try {
		const response = await fetch(path, {
			body: JSON.stringify(body ?? {}),
			credentials: 'include',
			headers: jsonHeaders,
			method: 'POST',
			signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
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
	} catch {
		return { error: 'failed', ok: false, status: 0 }
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
