import { getDataLoader, type PayloadRequest } from 'payload'
import { ENCRYPTED_CONTEXT_KEY } from './types'

/**
 * Run reads with encrypted fields left as stored ciphertext, then put the
 * request back exactly as it was. Inside the window the write-only response
 * strip and the decrypt-on-read step stand down for every encrypted field the
 * reads touch, so the caller's own queries return `pfe1.…` wire strings for
 * `decryptFieldValue`. The previous mode is restored rather than cleared, so a
 * window nested in another does not close it.
 *
 * The request's dataloader is swapped for a private one and restored too: its
 * cache key does not include the context, so a related document populated at
 * `depth > 0` in here would otherwise be cached as ciphertext and served that
 * way to an ordinary read later on the same request.
 *
 * Two caller constraints: the reads inside must be given this same `req` (the
 * mode travels on the request), and the window is not a concurrency boundary
 * (an unrelated read overlapping it sees ciphertext too).
 */
export const withRawEncrypted = async <T>(
	req: PayloadRequest,
	read: () => Promise<T>
): Promise<T> => {
	// A hand-built request (tests, jobs) may carry no context at all, and the
	// mode has nowhere to live without one.
	if (!req.context) {
		req.context = {}
	}
	const hadMode = ENCRYPTED_CONTEXT_KEY in req.context
	const previousMode = req.context[ENCRYPTED_CONTEXT_KEY]
	const previousLoader = req.payloadDataLoader
	try {
		req.context[ENCRYPTED_CONTEXT_KEY] = 'raw'
		req.payloadDataLoader = getDataLoader(req)
		return await read()
	} finally {
		// Read `req.context` again rather than closing over it: a local API
		// operation replaces the object with a merged copy, so the property has to
		// be restored on whichever object is current.
		const context = req.context ?? {}
		if (hadMode) {
			context[ENCRYPTED_CONTEXT_KEY] = previousMode
		} else {
			delete context[ENCRYPTED_CONTEXT_KEY]
		}
		req.payloadDataLoader = previousLoader
	}
}
