import { parseCookies } from 'payload/shared'

import type { ResolvedOptions } from '../types'
import { IMPERSONATION_SID_PREFIX } from './constants'

/**
 * Whether this authenticated request can belong to an impersonation row.
 * Custom `session.issue` skips the prefix, so those hosts always look up.
 */
export const shouldLookupImpersonation = ({
	headers,
	options,
	sid,
}: {
	headers: Headers
	options: Pick<ResolvedOptions, 'hintCookieName' | 'session'>
	sid: string
}): boolean => {
	if (options.session.issue) {
		return true
	}
	if (sid.startsWith(IMPERSONATION_SID_PREFIX)) {
		return true
	}
	return parseCookies(headers).has(options.hintCookieName)
}

export const readHintCookie = async (name: string): Promise<string | undefined> => {
	try {
		const spec: string = 'next/headers'
		const mod = (await import(spec)) as {
			cookies: () =>
				| { get: (key: string) => { value?: string } | undefined }
				| Promise<{ get: (key: string) => { value?: string } | undefined }>
		}
		const store = await mod.cookies()
		return store.get(name)?.value
	} catch {
		return undefined
	}
}
