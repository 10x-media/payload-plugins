import {
	commitTransaction,
	initTransaction,
	killTransaction,
	type Payload,
	type PayloadRequest,
} from 'payload'

import { SECRET_REVEAL_CONTEXT } from '../constants'
import { resolveSecretRotationOptions } from '../options'
import { decryptSecret } from './crypto'
import { generateSecret, normalizeSecret } from './format'
import { withRevealWindow } from './revealWindow'

/**
 * Raised when the subscription changed between this rotation's read and its write. The endpoint
 * maps it to 409: the caller retries and reads the winner's secret rather than silently
 * overwriting it.
 */
export class RotationConflictError extends Error {
	constructor(id: string) {
		super(
			`@10x-media/webhooks: subscription ${id} was modified during rotation; no secret was changed. Retry the rotation.`
		)
		this.name = 'RotationConflictError'
	}
}

export type RotateSecretResult = {
	id: string
	/** The new plaintext secret. Returned exactly once, like the create reveal. */
	secret: string
	/** When the rotated-out secret stops signing, or null when it was retired immediately. */
	previousSecretExpiresAt: string | null
}

/**
 * The subscription's secret exactly as stored, plus the plaintext behind it.
 *
 * The stored form is read rather than the decrypted one because it doubles as this rotation's
 * compare-and-swap token: it is what the write below requires to still be in place. Decrypting it
 * here rather than through the signing reveal window keeps both from a single read, and keeps the
 * token and the plaintext guaranteed to describe the same value.
 */
const currentSecret = async (args: {
	payload: Payload
	req: PayloadRequest
	subscriptionsSlug: string
	id: string
}): Promise<{ stored: string | null; plaintext: string | null }> => {
	const doc = await withRevealWindow(args.req, SECRET_REVEAL_CONTEXT.raw, () =>
		args.payload.findByID({
			collection: args.subscriptionsSlug,
			id: args.id,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
	)
	const stored = typeof doc.secret === 'string' && doc.secret !== '' ? doc.secret : null
	// An unreadable secret has nothing worth carrying into a grace period, and rotation is the
	// documented recovery for exactly that state. It still serves as the swap token.
	return { stored, plaintext: stored ? decryptSecret(args.payload, stored) : null }
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
	const { payload, req, subscriptionsSlug, id } = args
	const now = args.now ?? Date.now()
	// Direct callers bypass the endpoint's parsing, so the bounds are enforced here too rather
	// than only on the request path.
	const { graceSeconds } = resolveSecretRotationOptions({ graceSeconds: args.graceSeconds })
	const next = args.secret ? normalizeSecret(args.secret) : generateSecret()

	// Read and write share a transaction, and the write is conditional on the secret the read saw.
	// A transaction alone is not enough: under Postgres' default READ COMMITTED, two rotations can
	// both read the same secret, and the second write simply lands on top of the first, retiring a
	// secret that is already gone and leaving the first caller holding one that never signs. The
	// condition turns that into a conflict the caller can retry.
	const opened = await initTransaction(req)
	try {
		const { stored, plaintext: outgoing } = await currentSecret({
			payload,
			req,
			subscriptionsSlug,
			id,
		})
		const keepPrevious = graceSeconds > 0 && outgoing !== null && outgoing !== next
		const expiresAt = keepPrevious ? new Date(now + graceSeconds * 1000).toISOString() : null

		const result = await payload.update({
			collection: subscriptionsSlug,
			where: {
				and: [
					{ id: { equals: id } },
					stored === null ? { secret: { exists: false } } : { secret: { equals: stored } },
				],
			},
			data: {
				secret: next,
				previousSecret: keepPrevious ? outgoing : null,
				previousSecretExpiresAt: expiresAt,
			},
			overrideAccess: true,
			req,
		})

		if (result.docs.length === 0) {
			throw new RotationConflictError(id)
		}

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
