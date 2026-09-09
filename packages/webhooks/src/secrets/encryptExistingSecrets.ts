import { isSealed, withRawEncrypted } from '@10x-media/fields/encrypted'
import { type CollectionSlug, createLocalReq, type JsonObject, type Payload } from 'payload'

import { DEFAULT_SUBSCRIPTIONS_SLUG } from '../constants'
import { InvalidSecretError, normalizeSecret } from './format'
import type { SecretPath } from './secretFields'

export type SecretMigrationReport = {
	scanned: number
	/**
	 * Rows with at least one plaintext secret normalized and encrypted. Under `dryRun` this counts
	 * the rows that would change rather than rows that did.
	 */
	migrated: number
	/** Rows already holding ciphertext in every populated secret field, left untouched. */
	alreadyEncrypted: number
	/** Rows carrying no secret at all, so there was nothing to encrypt. */
	noSecret: number
	/**
	 * Secrets that could not be normalized, one entry per field, each needing a manual rotation. A
	 * row whose other secret field migrated fine appears in `migrated` as well: one unusable field
	 * is no reason to leave a recoverable one in plaintext.
	 */
	failed: { field: SecretPath; id: string; reason: string }[]
}

export type EncryptExistingSecretsOptions = {
	subscriptionsSlug?: string
	batchSize?: number
	/** Report what would change without writing. */
	dryRun?: boolean
}

const SECRET_FIELDS: SecretPath[] = ['secret', 'previousSecret']

/**
 * Adoption path for subscriptions written before secrets were encrypted at rest. Each plaintext
 * secret is normalized to `whsec_<base64>` and written back through the encrypted field, which
 * seals it; rows already holding ciphertext are skipped, so the run is idempotent and safe to
 * repeat.
 *
 * On a SQL adapter this needs the schema migration that adds the encrypted field's columns to
 * have run first. Without it the write has nowhere to put the sealed value.
 *
 * Normalizing does not invent a new secret. A legacy 48-character hex secret is valid base64, so
 * it keeps its characters and simply gains the `whsec_` prefix: the value an operator already
 * holds still works, given to a Standard Webhooks verifier in its prefixed form. Receivers must
 * be updated regardless, because the signature scheme itself changed.
 *
 * A secret that cannot be normalized (a customer-supplied value that is not base64) is reported
 * rather than rewritten, since guessing at it would silently break signing. Rotate those. It is
 * reported per field, and a row's other secret field still migrates: one unusable value is no
 * reason to leave a recoverable one sitting in plaintext.
 */
export const encryptExistingSecrets = async (
	payload: Payload,
	options: EncryptExistingSecretsOptions = {}
): Promise<SecretMigrationReport> => {
	const slug = options.subscriptionsSlug ?? DEFAULT_SUBSCRIPTIONS_SLUG
	const batchSize = options.batchSize ?? 100
	const report: SecretMigrationReport = {
		scanned: 0,
		migrated: 0,
		alreadyEncrypted: 0,
		noSecret: 0,
		failed: [],
	}
	// The raw window rides on a request, and the scan has no caller to borrow one from. Its own
	// request is also what keeps the write below outside the window, so the field's seal hook runs
	// normally rather than being told to leave the value alone.
	const req = await createLocalReq({}, payload)

	let page = 1
	let hasNextPage = true
	while (hasNextPage) {
		const result = await withRawEncrypted(req, () =>
			payload.find({
				collection: slug as CollectionSlug,
				depth: 0,
				limit: batchSize,
				overrideAccess: true,
				page,
				req,
			})
		)

		for (const doc of result.docs) {
			report.scanned += 1
			const id = String((doc as { id: string | number }).id)
			const patch: Record<string, string> = {}
			let populated = 0
			let failures = 0

			for (const field of SECRET_FIELDS) {
				const value = (doc as JsonObject)[field]
				if (typeof value !== 'string' || value === '') {
					continue
				}
				populated += 1
				if (isSealed(value)) {
					continue
				}
				try {
					patch[field] = normalizeSecret(value)
				} catch (err) {
					failures += 1
					report.failed.push({
						field,
						id,
						reason: err instanceof InvalidSecretError ? err.reason : String(err),
					})
				}
			}

			if (!populated) {
				report.noSecret += 1
				continue
			}
			if (!Object.keys(patch).length) {
				// Nothing to write: either every populated field is already ciphertext, or the only
				// plaintext ones are unusable and have been reported for rotation.
				if (!failures) {
					report.alreadyEncrypted += 1
				}
				continue
			}
			if (!options.dryRun) {
				// Written as plaintext, outside the raw window: the encrypted field's beforeChange
				// validates and seals it.
				await payload.update({
					collection: slug as CollectionSlug,
					id,
					data: patch,
					overrideAccess: true,
				})
			}
			report.migrated += 1
		}

		hasNextPage = result.hasNextPage
		page += 1
	}

	return report
}
