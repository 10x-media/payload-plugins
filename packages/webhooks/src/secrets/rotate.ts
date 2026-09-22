import { readEncryptedField } from '@10x-media/fields/encrypted'
import {
	type CollectionSlug,
	commitTransaction,
	killTransaction,
	type Payload,
	type PayloadRequest,
} from 'payload'

import { resolveSecretRotationOptions } from '../options'
import { generateSecret, normalizeSecret } from './format'
import { recoverSecret } from './recover'

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
 * Open the rotation's transaction, asking a SQL adapter for snapshot isolation.
 *
 * The conditional write below cannot carry this on its own. Payload resolves a `where` to ids with
 * a SELECT and then updates each by id, so the check and the act are separate statements: under
 * Postgres' default READ COMMITTED both rotations match the same row, and the second simply
 * overwrites the first once the first commits. REPEATABLE READ turns that second write into a
 * serialization failure, which the endpoint already reports as a 409.
 *
 * Mongo needs none of this, since its transactions are snapshot-isolated and already abort the
 * loser, and its adapter takes an unrelated options shape, so it keeps whatever it was configured
 * with. `drizzle` is the marker for the SQL adapters rather than a list of adapter names.
 */
const beginRotation = async (req: PayloadRequest): Promise<boolean> => {
	if (req.transactionID) {
		if (req.transactionID instanceof Promise) {
			await req.transactionID
		}
		// Someone up the stack owns the transaction, so this is not ours to commit.
		return false
	}
	const db = req.payload.db as {
		beginTransaction?: (options?: unknown) => Promise<number | string | null>
		drizzle?: unknown
	}
	if (typeof db.beginTransaction !== 'function') {
		return false
	}
	const id = await db.beginTransaction(
		db.drizzle ? { isolationLevel: 'repeatable read' } : undefined
	)
	if (id === null || id === undefined) {
		// `@payloadcms/db-sqlite` no-ops `beginTransaction` unless the consumer sets
		// `transactionOptions`, and Postgres does the same with `transactionOptions: false`. The
		// rotation still runs, and the conditional write still catches the common case, but without
		// a transaction it cannot survive a genuinely concurrent rotation. Say so rather than
		// degrading silently.
		req.payload.logger.warn(
			`@10x-media/webhooks: the database adapter opened no transaction for this rotation, so it runs without snapshot isolation. Two rotations issued at the same moment can both appear to succeed while only one secret survives. Set 'transactionOptions' on the adapter to enable transactions.`
		)
		return false
	}
	req.transactionID = id
	return true
}

/**
 * The subscription's secret exactly as stored, plus the plaintext behind it.
 *
 * The stored form is read rather than the decrypted one because it doubles as this rotation's
 * compare-and-swap token: it is what the write below requires to still be in place. The read
 * joins the caller's request, so it sees this transaction's own view of the row.
 */
const currentSecret = async (args: {
	payload: Payload
	req: PayloadRequest
	subscriptionsSlug: string
	id: string
}): Promise<{ stored: string | null; plaintext: string | null }> => {
	const handle = await readEncryptedField(args.payload, {
		collection: args.subscriptionsSlug as CollectionSlug,
		id: args.id,
		path: 'secret',
		req: args.req,
	})
	const stored = typeof handle?.ciphertext === 'string' ? handle.ciphertext : null
	if (!stored) {
		return { stored: null, plaintext: null }
	}
	// An unreadable secret has nothing worth carrying into a grace period, and rotation is the
	// documented recovery for exactly that state. It still serves as the swap token.
	const recovered = await recoverSecret({
		payload: args.payload,
		path: 'secret',
		subscriptionsSlug: args.subscriptionsSlug,
		value: stored,
	})
	return { stored, plaintext: recovered.ok ? recovered.secret : null }
}

/**
 * Issue a new signing secret for a subscription, keeping the outgoing one valid for
 * `graceSeconds` so deliveries carry both signatures until receivers have switched over. The
 * caller supplies a secret or one is generated; either way it is normalized before storage.
 *
 * The write stores plaintext into `secret` and `previousSecret`; the encrypted field's own
 * `beforeChange` seals both, so this never handles ciphertext except as the swap token.
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
	const opened = await beginRotation(req)
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
			collection: subscriptionsSlug as CollectionSlug,
			where: {
				and: [
					{ id: { equals: id } },
					stored === null ? { secret: { exists: false } } : { secret: { equals: stored } },
				],
			},
			// Retiring a slot means writing null, which a generated document type models as merely
			// optional rather than nullable, so the write is passed opaquely, as the other plugins do.
			data: {
				secret: next,
				previousSecret: keepPrevious ? outgoing : null,
				previousSecretExpiresAt: expiresAt,
			} as never,
			overrideAccess: true,
			req,
		})

		// A bulk update reports a matched-but-failed document in `errors`, which is a different
		// problem from no match at all. Reading it first is what keeps a validation failure or a
		// hook error from being reported as a conflict and retried forever.
		const failure = result.errors?.[0]
		if (failure) {
			throw new Error(
				`@10x-media/webhooks: rotating the secret for subscription ${id} was rejected: ${failure.message}`
			)
		}
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
