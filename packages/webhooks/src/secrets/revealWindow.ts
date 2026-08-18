import type { PayloadRequest } from 'payload'

import type { SECRET_REVEAL_CONTEXT } from '../constants'

type RevealFlag = (typeof SECRET_REVEAL_CONTEXT)[keyof typeof SECRET_REVEAL_CONTEXT]

/**
 * Run a read with one reveal flag open, and put the flag back exactly as it was.
 *
 * Restoring rather than clearing is what makes these windows safe to nest. A read that forced the
 * flag to `false` on the way out would close a window its caller was still relying on, and the
 * next read on that request would see the mask instead of key material: masked secrets used to
 * mean an unsigned delivery, and now mean a refused one, so either way the damage is silent and
 * far from the call that caused it.
 */
export const withRevealWindow = async <T>(
	req: PayloadRequest,
	flag: RevealFlag,
	read: () => Promise<T>
): Promise<T> => {
	const previous = req.context[flag]
	req.context[flag] = true
	try {
		return await read()
	} finally {
		req.context[flag] = previous
	}
}
