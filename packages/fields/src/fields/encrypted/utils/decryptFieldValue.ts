import type { Payload } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import { buildAad } from '../crypto/aad'
import { resolveKeys } from '../crypto/keys'
import { isSealed, unseal } from '../crypto/wire'
import { scanEncryptedFields } from '../scan'
import { aadScopeOf, type EncryptedFieldMarker } from '../types'

/** Which document schema an encrypted field lives in: a collection or a global. */
export interface EncryptedFieldTarget {
	collection?: string
	global?: string
	/** Dot path of the encrypted field within the schema, e.g. `smtp.password`. */
	path: string
	/** Locale of a localized value. Omitted, every configured locale is tried. */
	locale?: string
}

export interface DecryptFieldValueArgs extends EncryptedFieldTarget {
	/** The raw stored wire string (`pfe1.…`), e.g. cached from `readEncryptedField`. */
	value: string
}

export interface ResolvedEncryptedField {
	marker: EncryptedFieldMarker
	slug: string
}

/** Resolves a target's schema slug and encrypted-field marker, or throws with the reason. */
export const resolveEncryptedField = (
	payload: Payload,
	target: Pick<EncryptedFieldTarget, 'collection' | 'global' | 'path'>
): ResolvedEncryptedField => {
	const { collection, global, path } = target
	if ((collection && global) || (!collection && !global)) {
		throw new Error(
			`@10x-media/fields: pass exactly one of 'collection' or 'global' for encrypted field '${path}'`
		)
	}
	const slug = (collection ?? global) as string
	const fields = collection
		? payload.config.collections.find((entry) => entry.slug === collection)?.fields
		: payload.config.globals.find((entry) => entry.slug === global)?.fields
	if (!fields) {
		throw new Error(
			`@10x-media/fields: no ${collection ? 'collection' : 'global'} with slug '${slug}'`
		)
	}
	const marker = scanEncryptedFields(fields).get(path)
	if (!marker) {
		throw new Error(`@10x-media/fields: '${slug}.${path}' is not an encrypted field`)
	}
	return { marker, slug }
}

/** Read-side AAD candidates for a marker outside a document read (mirrors decryptAllData). */
export const aadCandidatesFor = (
	payload: Payload,
	{ locale, marker, slug }: ResolvedEncryptedField & { locale?: string }
): string[] => {
	const scope = aadScopeOf(marker, slug)
	if (!marker.localized) {
		return [buildAad([scope, marker.fieldName])]
	}
	const codes = payload.config.localization ? payload.config.localization.localeCodes : []
	const ordered = locale ? [locale, ...codes.filter((code) => code !== locale)] : codes
	return ordered.map((code) => buildAad([scope, marker.fieldName, code]))
}

/**
 * Decrypts one stored encrypted value outside a document read, given only its
 * field path and the raw wire string. Keys and AAD resolve from the config, so
 * a ciphertext cached earlier (e.g. via `readEncryptedField().ciphertext`)
 * decrypts on demand without plaintext ever sitting in the cache. A non-sealed
 * value (pre-adoption plaintext at rest) is returned as-is.
 *
 * Server-only and access-unchecked by design: calling it is the deliberate act.
 * Guard call sites accordingly, and never forward the result to a client.
 */
export const decryptFieldValue = async (
	payload: Payload,
	args: DecryptFieldValueArgs
): Promise<unknown> => {
	const { locale, value } = args
	const resolved = resolveEncryptedField(payload, args)
	if (!isSealed(value)) {
		return value
	}
	const registry = getFieldsRegistry(payload.config)
	const ring = await resolveKeys(
		resolved.marker.keys ?? registry?.encrypted?.keys,
		payload.config.secret
	)
	return unseal(value, ring.dataKeys, aadCandidatesFor(payload, { ...resolved, locale }))
}
