import type { ServerProps } from 'payload'
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

/** Reads the hint cookie in a server component, through Payload's framework-neutral server adapter. */
export const readHintCookie = async (
	server: ServerProps['server'] | undefined,
	name: string
): Promise<string | undefined> => {
	try {
		const store = await server?.getCookies()
		return store?.get(name)?.value
	} catch {
		return undefined
	}
}
