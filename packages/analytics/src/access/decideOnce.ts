import type { PayloadRequest } from 'payload'
import { requestMemo } from '../plugin/requestMemo'

const decisions = requestMemo<boolean>('accessDecisions')

interface Decision {
	/** Whatever answers it, the runtime or the host's access function: two never share an answer. */
	owner: object
	/** What is being decided, unique per owner. */
	key: string
	decide: () => boolean | Promise<boolean>
}

/**
 * Asked at most once per request however many reads ask it; a decision that throws rejects every
 * caller alike.
 */
export const decideOnce = (
	req: PayloadRequest,
	{ owner, key, decide }: Decision
): Promise<boolean> => decisions(req, { owner, key, compute: decide })
