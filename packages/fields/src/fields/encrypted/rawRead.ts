import { getDataLoader, type PayloadRequest } from 'payload'
import { ENCRYPTED_CONTEXT_KEY } from './types'

/**
 * Run reads with encrypted fields left as stored ciphertext, then put the
 * request back exactly as it was.
 *
 * This is the batch counterpart to `readEncryptedField`. That helper issues its
 * own `findByID` per document, which is the wrong shape when a caller already
 * has one query returning many rows and wants the rest of each document too:
 * a delivery pipeline resolving every subscription for an event wants one
 * `find`, not one per row. Inside this window the caller writes that query
 * themselves, with their own `where`, `limit`, `sort` and `select`, and the
 * write-only response strip and decrypt-on-read step both stand down, so each
 * encrypted field arrives as its `pfe1.…` wire string. Pass the values to
 * `decryptFieldValue` to recover plaintext.
 *
 * Restoring rather than clearing is what makes the window safe to nest. A read
 * that forced the mode off on the way out would close a window its caller was
 * still relying on, and the reads after it would decrypt when the caller had
 * asked for ciphertext.
 *
 * The request's dataloader is swapped for a private one and restored too.
 * Relationship population at `depth > 0` caches documents on the request, and
 * the cache key does not include the context, so a related document pulled in
 * while this window is open would otherwise be cached as ciphertext and served
 * that way to an ordinary read later in the same request.
 *
 * Two things this cannot do for you. The reads inside must be given the same
 * `req`, because the mode travels on the request. And the window is not a
 * concurrency boundary: an unrelated read on this request that overlaps it
 * sees ciphertext too, so do not run one alongside on purpose.
 *
 * ```ts
 * const subscriptions = await withRawEncrypted(req, () =>
 *   payload.find({ collection: 'subscriptions', depth: 0, overrideAccess: true, req, where })
 * )
 * const secret = await decryptFieldValue(payload, {
 *   collection: 'subscriptions',
 *   path: 'signingSecret',
 *   value: subscriptions.docs[0].signingSecret,
 * })
 * ```
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
