import type { RequestContext } from 'payload'

/**
 * Marks a request whose writes the lock lets through. Internal: it exists for
 * the jobs integration draining in-flight jobs, and is deliberately not an
 * option a person or role can reach.
 */
export const CONTENT_LOCK_BYPASS = Symbol.for('@10x-media/content-lock:bypass')

export const hasBypass = (context: RequestContext | undefined): boolean =>
	Boolean(context && (context as Record<symbol, unknown>)[CONTENT_LOCK_BYPASS])
