import {
	commitTransaction,
	initTransaction,
	killTransaction,
	type Payload,
	type PayloadRequest,
} from 'payload'

import { SECRET_REVEAL_CONTEXT, SECRET_UNUSABLE } from '../constants'
import { generateSecret, normalizeSecret } from './format'

export type RotateSecretResult = {
	id: string
	/** The new plaintext secret. Returned exactly once, like the create reveal. */
	secret: string
	/** When the rotated-out secret stops signing, or null when it was retired immediately. */
	previousSecretExpiresAt: string | null
}

/**
 * Read the subscription's current plaintext secret through the existing signing reveal window.
 * Returns null when the row has no secret or its ciphertext cannot be decrypted, in which case
 * there is nothing worth carrying into a grace period.
 */
const currentPlaintextSecret = async (args: {
	payload: Payload
	req: PayloadRequest
	subscriptionsSlug: string
	id: string
}): Promise<string | null> => {
	args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = true
	try {
		const doc = await args.payload.findByID({
			collection: args.subscriptionsSlug,
			id: args.id,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
		// An undecryptable secret reads back as the unusable sentinel. There is nothing to carry
		// into a grace period, and rotation is the documented recovery for exactly that state.
		if (typeof doc.secret !== 'string' || doc.secret === SECRET_UNUSABLE) {
			return null
		}
		return doc.secret
	} finally {
		args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = false
	}
}

/**
 * Issue a new signing secret for a subscription, keeping the outgoing one valid for
 * `graceSeconds` so deliveries carry both signatures until receivers have switched over. The
 * caller supplies a secret or one is generated; either way it is normalized before storage.
 *
 * The write stores plaintext into `secret` and `previousSecret`; the collection's `beforeChange`
 * encrypts both, so this never handles ciphertext itself.
 */
export const rotateSubscriptionSecret = async (args: {
	payload: Payload
	req: PayloadRequest
	subscriptionsSlug: string
	id: string
	secret?: string
	graceSeconds: number
	now?: number
}): Promise<RotateSecretResult> => {
	const { payload, req, subscriptionsSlug, id, graceSeconds } = args
	const now = args.now ?? Date.now()
	const next = args.secret ? normalizeSecret(args.secret) : generateSecret()

	// Read and write share a transaction: rotation is a read-modify-write, and two concurrent
	// rotations that both read before either writes would otherwise both retire the same original
	// secret, leaving the loser's caller holding a secret that never signs anything.
	const opened = await initTransaction(req)
	try {
		const outgoing = await currentPlaintextSecret({ payload, req, subscriptionsSlug, id })
		const keepPrevious = graceSeconds > 0 && outgoing !== null && outgoing !== next
		const expiresAt = keepPrevious ? new Date(now + graceSeconds * 1000).toISOString() : null

		await payload.update({
			collection: subscriptionsSlug,
			id,
			data: {
				secret: next,
				previousSecret: keepPrevious ? outgoing : null,
				previousSecretExpiresAt: expiresAt,
			},
			overrideAccess: true,
			req,
		})

		if (opened) {
			await commitTransaction(req)
		}
		return { id, secret: next, previousSecretExpiresAt: expiresAt }
	} catch (err) {
		if (opened) {
			await killTransaction(req)
		}
		throw err
	}
}
