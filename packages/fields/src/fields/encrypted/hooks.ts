import type { FieldHook, PayloadRequest, RichTextField, SanitizedConfig, Validate } from 'payload'
import { getFieldsRegistry } from '../../plugin/registry'
import type { DecryptFailurePolicy } from '../../types'
import { buildAad } from './crypto/aad'
import { computeBidx } from './crypto/bidx'
import { type KeyRing, resolveKeys } from './crypto/keys'
import { isSealed, parseWire, seal, unseal } from './crypto/wire'
import { makeHint } from './hint'
import { sealedArrayKey, stashPlaintext } from './plaintextStash'
import {
	ENCRYPTED_CONTEXT_KEY,
	type EncryptedContextMode,
	type EncryptedFieldMarker,
} from './types'

export interface DecryptFailedArgs {
	cause: unknown
	field: string
	keyId: string | undefined
	slug: string
}

/** Raised on read when decryption fails and the policy is 'throw'. */
export class DecryptFailedError extends Error {
	constructor({ cause, field, keyId, slug }: DecryptFailedArgs) {
		const keyInfo = keyId ? ` (keyId '${keyId}')` : ''
		super(
			`@10x-media/fields: failed to decrypt ${slug}.${field}${keyInfo}: ${cause instanceof Error ? cause.name : 'unknown error'}`
		)
		this.name = 'DecryptFailedError'
		this.cause = cause
	}
}

export const ringForRequest = (
	req: PayloadRequest,
	marker: EncryptedFieldMarker
): Promise<KeyRing> => {
	const registry = getFieldsRegistry(req.payload.config)
	return resolveKeys(marker.keys ?? registry?.encrypted?.keys, req.payload.config.secret)
}

type SlugHolder = { slug: string } | null | undefined

const aadSlug = (collection: SlugHolder, global: SlugHolder): string =>
	collection?.slug ?? global?.slug ?? ''

const defaultLocale = (config: SanitizedConfig): string =>
	config.localization ? config.localization.defaultLocale : 'en'

/** Mirrors beforeChange/promise.ts: the locale a write applies to. */
const operationLocale = (req: PayloadRequest): string => {
	const locale = req.locale
	if (!locale || locale === 'all') {
		return defaultLocale(req.payload.config)
	}
	return locale
}

/**
 * AAD binds a ciphertext to its `${slug}.${field}[.${locale}]` slot via
 * buildAad, which rejects any dotted component so the joined data stays
 * unambiguous (a dotted slug/locale would blur the cross-field binding).
 */
export const sealAad = (marker: EncryptedFieldMarker, slug: string, req: PayloadRequest): string =>
	buildAad(
		marker.localized ? [slug, marker.fieldName, operationLocale(req)] : [slug, marker.fieldName]
	)

/**
 * Read-side AAD candidates. Localized fields try the request locale first,
 * then every configured locale: fallbackLocale hoisting and locale=all hook
 * execution mean the hook cannot know which locale sealed the value.
 */
export const readAadCandidates = (
	marker: EncryptedFieldMarker,
	slug: string,
	req: PayloadRequest
): string[] => {
	if (!marker.localized) {
		return [buildAad([slug, marker.fieldName])]
	}
	const codes = req.payload.config.localization
		? req.payload.config.localization.localeCodes
		: [defaultLocale(req.payload.config)]
	const first = operationLocale(req)
	const ordered = [first, ...codes.filter((code) => code !== first)]
	return ordered.map((code) => buildAad([slug, marker.fieldName, code]))
}

/**
 * The active utility mode from the request context, or undefined for a normal
 * operation (including a missing context, which reads as normal). Reused by the
 * response stripper so bulk utilities (which read in `raw` mode) still see the
 * ciphertext and blind-index siblings, while a normal read strips them.
 */
export const contextMode = (
	context: Record<string, unknown> | undefined
): EncryptedContextMode | undefined => {
	const mode = context?.[ENCRYPTED_CONTEXT_KEY]
	return mode === 'decrypt' || mode === 'raw' || mode === 'rotate' ? mode : undefined
}

/** A locale=all write hands the hook a `{ [locale]: value }` map, not a scalar. */
const isLocaleMap = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

interface SealForLocaleArgs {
	aad: string
	hasMany: boolean
	key: Buffer
	keyId: string
}

/** Seal one locale's value, passing already-sealed items through unchanged. */
const sealValueForLocale = (value: unknown, args: SealForLocaleArgs): unknown => {
	if (value == null) {
		return value
	}
	const sealItem = (item: unknown): unknown =>
		isSealed(item)
			? item
			: seal({ aad: args.aad, key: args.key, keyId: args.keyId, plaintext: item })
	return args.hasMany && Array.isArray(value) ? value.map(sealItem) : sealItem(value)
}

export const makeBeforeChangeHook = (marker: EncryptedFieldMarker): FieldHook => {
	return async (args) => {
		const { collection, global, req, siblingData, value } = args
		const mode = contextMode(req.context as Record<string, unknown>)

		// Utilities read ciphertext untouched.
		if (mode === 'raw') {
			return value
		}
		// Removal path: store incoming plaintext without sealing, drop the now
		// meaningless blind index and hint.
		if (mode === 'decrypt') {
			if (marker.queryable && marker.bidxName) {
				siblingData[marker.bidxName] = null
			}
			if (marker.hintName) {
				siblingData[marker.hintName] = null
			}
			return value
		}

		const slug = aadSlug(collection, global)
		const ring = await ringForRequest(req, marker)
		const activeKey = ring.dataKeys.get(ring.activeId) as Buffer

		if (mode === 'rotate') {
			const candidates = readAadCandidates(marker, slug, req)
			const writeAad = sealAad(marker, slug, req)
			const rotateOne = (item: unknown): unknown => {
				if (!isSealed(item)) {
					return item
				}
				if (parseWire(item).keyId === ring.activeId) {
					return item
				}
				const plaintext = unseal(item, ring.dataKeys, candidates)
				if (marker.queryable && marker.bidxName) {
					siblingData[marker.bidxName] = computeBidx(plaintext, ring.indexKey, marker.normalize)
				}
				return seal({ aad: writeAad, key: activeKey, keyId: ring.activeId, plaintext })
			}
			return marker.hasMany && Array.isArray(value) ? value.map(rotateOne) : rotateOne(value)
		}

		if (value === undefined) {
			return undefined
		}
		// A write-only empty string clears like null: sealing '' would create a
		// trap state ("set" with an empty credential) that no caller can ever
		// read back to diagnose. The admin never sends '', so this only guards
		// direct API writes; other encrypted fields keep sealing '' as before.
		if (value === null || (marker.writeOnly && value === '')) {
			if (marker.queryable && marker.bidxName) {
				siblingData[marker.bidxName] = null
			}
			if (marker.hintName) {
				siblingData[marker.hintName] = null
			}
			return null
		}

		// locale=all write: value is a `{ [locale]: value }` map. Seal each locale
		// under its own locale AAD so afterRead's per-locale unseal opens it (a
		// single blob sealed under the default-locale AAD would not). Plaintext
		// validation and blind-index maintenance for bulk all-locales writes are
		// deferred to per-locale writes (covered by Batch E int tests).
		if (marker.localized && req.locale === 'all' && isLocaleMap(value)) {
			const sealedMap: Record<string, unknown> = {}
			const hintMap: Record<string, unknown> = {}
			for (const [locale, localeValue] of Object.entries(value)) {
				sealedMap[locale] = sealValueForLocale(localeValue, {
					aad: buildAad([slug, marker.fieldName, locale]),
					hasMany: marker.hasMany,
					key: activeKey,
					keyId: ring.activeId,
				})
				if (marker.hint && !isSealed(localeValue)) {
					hintMap[locale] = localeValue == null ? null : makeHint(localeValue, marker.hint)
				}
			}
			if (marker.hintName && Object.keys(hintMap).length > 0) {
				siblingData[marker.hintName] = hintMap
			}
			return sealedMap
		}

		const aad = sealAad(marker, slug, req)
		const sealOne = (item: unknown): string =>
			seal({ aad, key: activeKey, keyId: ring.activeId, plaintext: item })

		if (marker.hasMany) {
			if (!Array.isArray(value)) {
				return value
			}
			// Seal PER ITEM so an already-sealed item (a passthrough from a prior
			// read, e.g. a mixed array) is never wrapped in a second GCM layer.
			const sealedArray = value.map((item) => (isSealed(item) ? item : sealOne(item)))
			// Stash the plaintext for the composed validate, keyed by the sealed
			// output (unique per write), only for a fresh all-plaintext write. A
			// mixed/passthrough array is not stashed; its already-sealed items were
			// validated when first written, so their re-validation is deferred.
			if (!value.some(isSealed)) {
				stashPlaintext(req, sealedArrayKey(sealedArray), value)
			}
			return sealedArray
		}

		// Single value already sealed: a resubmitted read or unchanged sibling;
		// passthrough without re-sealing (no plaintext to stash).
		if (isSealed(value)) {
			return value
		}
		// Stash the plaintext for the composed validate, keyed by the sealed value
		// (unique per write); do not validate/throw here.
		const sealed = sealOne(value)
		stashPlaintext(req, sealed, value)
		if (marker.queryable && marker.bidxName) {
			siblingData[marker.bidxName] = computeBidx(value, ring.indexKey, marker.normalize)
		}
		// The hint derives from the same plaintext this seal consumes, so hint and
		// ciphertext can never drift. A sealed passthrough above never lands here,
		// which is what keeps an unchanged value's hint intact.
		if (marker.hint && marker.hintName) {
			siblingData[marker.hintName] = makeHint(value, marker.hint)
		}
		return sealed
	}
}

interface ApplyPolicyArgs {
	error: unknown
	marker: EncryptedFieldMarker
	policy: DecryptFailurePolicy
	raw: unknown
	slug: string
}

const applyPolicy = ({ error, marker, policy, raw, slug }: ApplyPolicyArgs): unknown => {
	if (policy === 'null') {
		return null
	}
	if (policy === 'passthrough') {
		return raw
	}
	if (typeof policy === 'function') {
		return policy({
			collection: slug,
			error,
			field: marker.fieldName,
			value: typeof raw === 'string' ? raw : String(raw),
		})
	}
	const keyId = isSealed(raw) ? (raw as string).split('.')[1] : undefined
	throw new DecryptFailedError({ cause: error, field: marker.fieldName, keyId, slug })
}

interface OpenSealedArgs {
	candidates: string[]
	marker: EncryptedFieldMarker
	policy: DecryptFailurePolicy
	ring: KeyRing
	slug: string
}

/**
 * Unseals one value, applying the decrypt-failure policy on a non-sealed item
 * (plaintext at rest is pre-adoption data; passthrough is the lazy-migration
 * mode) or a failed unseal. Shared by the scalar afterRead hook and the
 * richText decrypt hook.
 */
const openSealed = (item: unknown, args: OpenSealedArgs): unknown => {
	const { candidates, marker, policy, ring, slug } = args
	if (!isSealed(item)) {
		return applyPolicy({ error: new Error('value is not sealed'), marker, policy, raw: item, slug })
	}
	try {
		return unseal(item, ring.dataKeys, candidates)
	} catch (error) {
		return applyPolicy({ error, marker, policy, raw: item, slug })
	}
}

const resolvePolicy = (req: PayloadRequest, marker: EncryptedFieldMarker): DecryptFailurePolicy => {
	const registry = getFieldsRegistry(req.payload.config)
	return marker.onDecryptFailure ?? registry?.encrypted?.onDecryptFailure ?? 'throw'
}

export const makeAfterReadHook = (marker: EncryptedFieldMarker): FieldHook => {
	return async (args) => {
		const { collection, context, global, req, value } = args
		if (value === undefined || value === null) {
			return value
		}
		if (contextMode(context)) {
			return value
		}
		// Write-only never decrypts on read: the sealed value passes through and the
		// collection/global strip hook removes the field from the response, so even
		// standalone usage (no plugin, no strip) exposes ciphertext at worst.
		if (marker.writeOnly) {
			return value
		}
		const slug = aadSlug(collection, global)
		const ring = await ringForRequest(req, marker)
		const openArgs: OpenSealedArgs = {
			candidates: readAadCandidates(marker, slug, req),
			marker,
			policy: resolvePolicy(req, marker),
			ring,
			slug,
		}
		const openOne = (item: unknown): unknown => openSealed(item, openArgs)
		return marker.hasMany && Array.isArray(value) ? value.map(openOne) : openOne(value)
	}
}

/**
 * Recursive presence check for a stored write-only sibling: arrays count only
 * when some item is present, locale maps only when some locale's value is,
 * including a locale map of arrays. `{ en: [] }` and `{ en: [null] }` read as
 * unset; a sealed string (or pre-adoption scalar) reads as set.
 */
const hasStoredValue = (value: unknown): boolean => {
	if (value == null) {
		return false
	}
	if (Array.isArray(value)) {
		return value.some(hasStoredValue)
	}
	if (typeof value === 'object') {
		return Object.values(value).some(hasStoredValue)
	}
	return true
}

/**
 * afterRead on the virtual set-indicator sibling of a write-only field: true
 * when the stored sibling holds anything (sealed, or pre-adoption plaintext).
 * A locale-map sibling (locale=all read) counts as set when any locale has a
 * value. Utility flows pass through so raw reads see no synthesized data.
 */
export const makeSetIndicatorHook = (fieldName: string): FieldHook => {
	return ({ context, siblingData, value }) => {
		if (contextMode(context)) {
			return value
		}
		return hasStoredValue((siblingData as Record<string, unknown>)[fieldName])
	}
}

/**
 * afterRead on the virtual richText field: decrypts the ciphertext sibling into
 * a SerializedEditorState. The virtual field is never persisted, so its own
 * value is always undefined and the ciphertext SIBLING is the source. The
 * ciphertext field has no afterRead, so that sibling holds raw ciphertext for
 * the whole phase, making this the single deterministic reader. Runs before the
 * editor's own afterRead, which then populates upload/relationship nodes on the
 * decrypted object.
 */
export const makeRichTextDecryptHook = (
	marker: EncryptedFieldMarker,
	storedName: string
): FieldHook => {
	return async (args) => {
		const { collection, context, global, req, siblingData } = args
		if (contextMode(context)) {
			return args.value
		}
		const ciphertext = (siblingData as Record<string, unknown>)[storedName]
		if (ciphertext === undefined || ciphertext === null) {
			return ciphertext
		}
		const slug = aadSlug(collection, global)
		const ring = await ringForRequest(req, marker)
		return openSealed(ciphertext, {
			candidates: readAadCandidates(marker, slug, req),
			marker,
			policy: resolvePolicy(req, marker),
			ring,
			slug,
		})
	}
}

/**
 * beforeChange on the virtual richText field: seals the submitted
 * SerializedEditorState into the ciphertext sibling and returns the plaintext
 * unchanged (Payload drops it at the DB write since the field is virtual). The
 * sole normal-mode writer of the ciphertext slot. Utility flows (rotate/decrypt/
 * raw) pass through untouched; the ciphertext field's own hook handles rotation.
 * An absent value (partial write) preserves the existing ciphertext.
 */
export const makeRichTextSealHook = (
	marker: EncryptedFieldMarker,
	storedName: string
): FieldHook => {
	return async (args) => {
		const { collection, global, req, siblingData, value } = args
		if (contextMode(req.context as Record<string, unknown>)) {
			return value
		}
		if (value === undefined) {
			return undefined
		}
		const sibling = siblingData as Record<string, unknown>
		if (value === null) {
			sibling[storedName] = null
			return null
		}
		const slug = aadSlug(collection, global)
		const ring = await ringForRequest(req, marker)
		const activeKey = ring.dataKeys.get(ring.activeId) as Buffer
		// locale=all write: value is a `{ [locale]: SerializedEditorState }` map.
		// Seal each locale under its own locale AAD so the per-locale decrypt opens
		// it, mirroring the scalar hook's locale-map handling.
		if (marker.localized && req.locale === 'all' && isLocaleMap(value)) {
			const sealedMap: Record<string, unknown> = {}
			for (const [locale, localeValue] of Object.entries(value)) {
				sealedMap[locale] =
					localeValue == null || isSealed(localeValue)
						? localeValue
						: seal({
								aad: buildAad([slug, marker.fieldName, locale]),
								key: activeKey,
								keyId: ring.activeId,
								plaintext: localeValue,
							})
			}
			sibling[storedName] = sealedMap
			return value
		}
		sibling[storedName] = isSealed(value)
			? value
			: seal({
					aad: sealAad(marker, slug, req),
					key: activeKey,
					keyId: ring.activeId,
					plaintext: value,
				})
		return value
	}
}

/**
 * beforeChange on the hidden ciphertext field. A no-op in every mode except
 * rotate (the virtual field's seal hook is the sole normal-mode producer of this
 * slot). Under rotate it unseals with the stale key and reseals with the active
 * key so rotateEncryptedFields round-trips, mirroring the scalar rotate branch.
 */
export const makeRichTextCiphertextHook = (marker: EncryptedFieldMarker): FieldHook => {
	return async (args) => {
		const { collection, global, req, value } = args
		if (contextMode(req.context as Record<string, unknown>) !== 'rotate') {
			return undefined
		}
		if (!isSealed(value)) {
			return value
		}
		const ring = await ringForRequest(req, marker)
		if (parseWire(value).keyId === ring.activeId) {
			return value
		}
		const slug = aadSlug(collection, global)
		const plaintext = unseal(value, ring.dataKeys, readAadCandidates(marker, slug, req))
		const activeKey = ring.dataKeys.get(ring.activeId) as Buffer
		return seal({
			aad: sealAad(marker, slug, req),
			key: activeKey,
			keyId: ring.activeId,
			plaintext,
		})
	}
}

/**
 * Validate for the virtual richText field. Delegates to the editor's own
 * validate (required + node-level validation) for full parity with a native
 * richText field. Skips utility flows and absent values: rotate/decrypt patch
 * only the ciphertext sibling, so the virtual value is undefined then, and a
 * required check must not trip on that.
 */
export const makeRichTextValidate = (): Validate<unknown, unknown, unknown, RichTextField> => {
	return (value, options) => {
		if (contextMode(options.req.context as Record<string, unknown>)) {
			return true
		}
		if (value === undefined) {
			return true
		}
		const { editor } = options
		if (!editor || typeof editor === 'function' || typeof editor.validate !== 'function') {
			return true
		}
		return editor.validate(value, options)
	}
}
