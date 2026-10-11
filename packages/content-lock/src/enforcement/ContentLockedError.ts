import { APIError } from 'payload'

export const CONTENT_LOCKED_ERROR_NAME = 'ContentLockedError'

export type ContentLockedErrorData = {
	/** When the lock is known to end, ISO; `null` for a manual end. */
	endsAt: string | null
	/** Ids of the active windows covering the blocked entity. */
	lockIds: string[]
}

/**
 * Thrown when a write hits frozen content. Carries HTTP 503; the plugin's
 * `afterError` hook adds the `Retry-After` header.
 */
export class ContentLockedError extends APIError<ContentLockedErrorData> {
	constructor(message: string, data: ContentLockedErrorData) {
		super(message, 503, data, true)
		this.name = CONTENT_LOCKED_ERROR_NAME
	}
}

/**
 * Whether `error` is a `ContentLockedError`. Checks the name as well as the
 * prototype, so it holds when two copies of the plugin are bundled.
 */
export const isContentLockedError = (error: unknown): error is ContentLockedError =>
	error instanceof ContentLockedError ||
	(error instanceof Error && error.name === CONTENT_LOCKED_ERROR_NAME)
