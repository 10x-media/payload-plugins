import type { RequestContext } from 'payload'

/**
 * Marks a request whose writes the lock lets through. Internal and
 * deliberately not an option: no person, role or setting can reach it.
 */
export const CONTENT_LOCK_BYPASS = Symbol.for('@10x-media/content-lock:bypass')

export const hasBypass = (context: RequestContext | undefined): boolean =>
	Boolean(context && (context as Record<symbol, unknown>)[CONTENT_LOCK_BYPASS])
