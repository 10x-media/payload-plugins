import type { QueryError } from '../query/errors'

/** Scope depends on the caller's cookies, so no shared cache may ever hold an answer. */
export const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** How long a client should wait out a provider outage before retrying the same read. */
export const RETRY_AFTER = { 'Retry-After': '30' }

/** A read endpoint's error answer: coded body, never cached, headers merged over `NO_STORE`. */
export const errorResponse = (
	status: number,
	error: QueryError,
	headers: Record<string, string> = {}
): Response => Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } })
