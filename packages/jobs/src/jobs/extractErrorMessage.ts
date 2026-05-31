/**
 * Pull a short, human-readable reason out of a job's `error` value: a string as
 * is, an object's `message` or `name`, or `"Cancelled"` for a cancellation.
 * Returns `undefined` when there is nothing meaningful to show.
 */
export const extractErrorMessage = (error: unknown): string | undefined => {
	if (typeof error === 'string') {
		return error || undefined
	}
	if (typeof error === 'object' && error !== null) {
		const value = error as { cancelled?: unknown; message?: unknown; name?: unknown }
		if (value.cancelled === true) {
			return 'Cancelled'
		}
		if (typeof value.message === 'string' && value.message) {
			return value.message
		}
		if (typeof value.name === 'string' && value.name) {
			return value.name
		}
	}
	return undefined
}
