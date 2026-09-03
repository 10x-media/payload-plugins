import { ProviderHttpError } from '../adapters/http/fetchJson'

const isAbortError = (err: unknown): boolean =>
	err instanceof Error &&
	(err.name === 'AbortError' || err.message === 'analytics: provider read timed out')

/** Retry classification for provider reads: 429 and 5xx back off (transient quota/server trouble), other HTTP statuses are the caller's bug and never retry, aborts never retry, anything non-HTTP is presumed a transient network failure and gets one more try. */
export const shouldRetryProviderError = (err: unknown, attempt: number): boolean => {
	if (err instanceof ProviderHttpError) {
		return (err.status === 429 || err.status >= 500) && attempt < 2
	}
	if (isAbortError(err)) return false
	return attempt < 1
}
