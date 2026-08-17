import type { Payload } from 'payload'

import { DEFAULT_SUBSCRIPTIONS_SLUG, SECRET_REVEAL_CONTEXT } from '../constants'
import { isEncryptedSecret } from './crypto'
import { InvalidSecretError, normalizeSecret } from './format'

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
	failed: { field: (typeof SECRET_FIELDS)[number]; id: string; reason: string }[]
}

export type EncryptExistingSecretsOptions = {
	subscriptionsSlug?: string
	batchSize?: number
	/** Report what would change without writing. */
	dryRun?: boolean
}

const SECRET_FIELDS = ['secret', 'previousSecret'] as const

/**
 * Adoption path for subscriptions written before secrets were encrypted at rest. Each plaintext
 * secret is normalized to `whsec_<base64>` and encrypted in place; rows already holding
 * ciphertext are skipped, so the run is idempotent and safe to repeat.
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

	let page = 1
	let hasNextPage = true
	while (hasNextPage) {
		const result = await payload.find({
			collection: slug,
			depth: 0,
			limit: batchSize,
			overrideAccess: true,
			page,
			context: { [SECRET_REVEAL_CONTEXT.raw]: true },
		})

		for (const doc of result.docs) {
			report.scanned += 1
			const id = String((doc as { id: string | number }).id)
			const patch: Record<string, string> = {}
			let populated = 0
			let failures = 0

			for (const field of SECRET_FIELDS) {
				const value = (doc as Record<string, unknown>)[field]
				if (typeof value !== 'string' || value === '') {
					continue
				}
				populated += 1
				if (isEncryptedSecret(value)) {
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
				// Written as plaintext: the collection's beforeChange encrypts and tags it.
				await payload.update({ collection: slug, id, data: patch, overrideAccess: true })
			}
			report.migrated += 1
		}

		hasNextPage = result.hasNextPage
		page += 1
	}

	return report
}
