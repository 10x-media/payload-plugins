import type { FieldHook, PayloadRequest, SanitizedConfig } from 'payload'
import { getFieldsRegistry } from '../../plugin/registry'
import type { DecryptFailurePolicy } from '../../types'
import { buildAad } from './crypto/aad'
import { computeBidx } from './crypto/bidx'
import { type KeyRing, resolveKeys } from './crypto/keys'
import { isSealed, parseWire, seal, unseal } from './crypto/wire'
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

const contextMode = (context: Record<string, unknown>): EncryptedContextMode | undefined => {
	const mode = context[ENCRYPTED_CONTEXT_KEY]
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
		// meaningless blind index.
		if (mode === 'decrypt') {
			if (marker.queryable && marker.bidxName) {
				siblingData[marker.bidxName] = null
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
		if (value === null) {
			if (marker.queryable && marker.bidxName) {
				siblingData[marker.bidxName] = null
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
			for (const [locale, localeValue] of Object.entries(value)) {
				sealedMap[locale] = sealValueForLocale(localeValue, {
					aad: buildAad([slug, marker.fieldName, locale]),
					hasMany: marker.hasMany,
					key: activeKey,
					keyId: ring.activeId,
				})
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

export const makeAfterReadHook = (marker: EncryptedFieldMarker): FieldHook => {
	return async (args) => {
		const { collection, context, global, req, value } = args
		if (value === undefined || value === null) {
			return value
		}
		if (contextMode(context)) {
			return value
		}
		const registry = getFieldsRegistry(req.payload.config)
		const policy: DecryptFailurePolicy =
			marker.onDecryptFailure ?? registry?.encrypted?.onDecryptFailure ?? 'throw'
		const slug = aadSlug(collection, global)
		const ring = await ringForRequest(req, marker)
		const candidates = readAadCandidates(marker, slug, req)
		const openOne = (item: unknown): unknown => {
			if (!isSealed(item)) {
				// Plaintext at rest: pre-adoption data. Policy decides (passthrough
				// is the lazy-migration mode).
				return applyPolicy({
					error: new Error('value is not sealed'),
					marker,
					policy,
					raw: item,
					slug,
				})
			}
			try {
				return unseal(item, ring.dataKeys, candidates)
			} catch (error) {
				return applyPolicy({ error, marker, policy, raw: item, slug })
			}
		}
		return marker.hasMany && Array.isArray(value) ? value.map(openOne) : openOne(value)
	}
}
