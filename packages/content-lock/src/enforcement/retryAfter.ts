import { type AfterErrorHook, getCurrentDate } from 'payload'

import { DEFAULT_RETRY_AFTER, type ResolvedOptions } from '../options'
import { type ContentLockedError, isContentLockedError } from './ContentLockedError'

/** The lock error behind `error`, unwrapping GraphQL's `originalError`. */
const lockErrorOf = (error: unknown): ContentLockedError | null => {
	if (isContentLockedError(error)) {
		return error
	}
	const original =
		typeof error === 'object' && error !== null && 'originalError' in error
			? (error as { originalError: unknown }).originalError
			: null
	return isContentLockedError(original) ? original : null
}

/** Seconds for `Retry-After`: fixed, or until the lock's known end. */
export const retryAfterSeconds = (
	setting: ResolvedOptions['retryAfter'],
	endsAt: string | null,
	now: Date
): number => {
	if (typeof setting === 'number') {
		return setting
	}
	if (endsAt === null) {
		return DEFAULT_RETRY_AFTER
	}
	return Math.max(1, Math.ceil((Date.parse(endsAt) - now.getTime()) / 1000))
}

/**
 * Root `afterError` hook adding `Retry-After` to lock rejections. Payload
 * merges `req.responseHeaders` into the error response for REST, custom
 * endpoints and GraphQL alike, so no endpoint needs wrapping.
 */
export const retryAfterHook =
	(setting: ResolvedOptions['retryAfter']): AfterErrorHook =>
	({ error, req }) => {
		const lockError = lockErrorOf(error)
		if (!lockError) {
			return
		}
		const seconds = retryAfterSeconds(setting, lockError.data?.endsAt ?? null, getCurrentDate())
		req.responseHeaders ??= new Headers()
		req.responseHeaders.set('Retry-After', String(seconds))
	}
