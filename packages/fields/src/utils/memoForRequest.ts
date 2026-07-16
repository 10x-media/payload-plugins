import type { PayloadRequest } from 'payload'

const caches = new WeakMap<PayloadRequest, Map<symbol, Promise<unknown>>>()

/**
 * Memoize an async computation per request so list views resolve shared data
 * (async color presets, icon availability) once instead of once per row. Keyed
 * on the request object via WeakMap, so entries vanish with the request.
 * Rejections stay cached for the request's lifetime; callers needing retry
 * semantics must catch inside `fn`.
 */
export const memoForRequest = <T>(
	req: PayloadRequest,
	key: symbol,
	fn: () => Promise<T>
): Promise<T> => {
	let bucket = caches.get(req)
	if (!bucket) {
		bucket = new Map()
		caches.set(req, bucket)
	}
	const cached = bucket.get(key)
	if (cached) {
		return cached as Promise<T>
	}
	const created = fn()
	bucket.set(key, created)
	return created
}
