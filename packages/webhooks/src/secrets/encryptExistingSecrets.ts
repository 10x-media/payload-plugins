import type { Payload } from 'payload'

import { DEFAULT_SUBSCRIPTIONS_SLUG, SECRET_REVEAL_CONTEXT } from '../constants'
import { isEncryptedSecret } from './crypto'
import { InvalidSecretError, normalizeSecret } from './format'

export type SecretMigrationReport = {
	scanned: number
	/** Rows whose plaintext secrets were normalized and encrypted. */
	migrated: number
	/** Rows already holding ciphertext, left untouched. */
	alreadyEncrypted: number
	/** Rows whose secret could not be normalized; each needs a manual rotation. */
	failed: { id: string; reason: string }[]
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
 * rather than rewritten, since guessing at it would silently break signing. Rotate those.
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
			let alreadyDone = true
			let failure: string | undefined

			for (const field of SECRET_FIELDS) {
				const value = (doc as Record<string, unknown>)[field]
				if (typeof value !== 'string' || value === '') {
					continue
				}
				if (isEncryptedSecret(value)) {
					continue
				}
				alreadyDone = false
				try {
					patch[field] = normalizeSecret(value)
				} catch (err) {
					failure = err instanceof InvalidSecretError ? err.reason : String(err)
				}
			}

			if (failure) {
				report.failed.push({ id, reason: failure })
				continue
			}
			if (alreadyDone) {
				report.alreadyEncrypted += 1
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
