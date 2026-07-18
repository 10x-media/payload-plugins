import type { PayloadRequest, Validate } from 'payload'
import {
	checkbox,
	code,
	date,
	email,
	json,
	number,
	point,
	radio,
	select,
	text,
	textarea,
} from 'payload/shared'
import { sealedArrayKey, takePlaintext } from './plaintextStash'
import type { EncryptedSourceField, EncryptedSourceType } from './types'

/**
 * Erasure signature at the stock-validator boundary. Payload types each
 * validator against its own field config; we dispatch by source type at
 * runtime, so the per-type generics are intentionally widened here.
 */
export type PlaintextValidator = (
	value: unknown,
	options: Record<string, unknown> & { req: PayloadRequest }
) => Promise<string | true> | string | true

const stockValidators: Partial<Record<EncryptedSourceType, unknown>> = {
	checkbox,
	code,
	date,
	email,
	json,
	number,
	point,
	radio,
	select,
	text,
	textarea,
}

/**
 * The validator that must see PLAINTEXT: the user's own validate when given,
 * else the stock validator matching the ORIGINAL field type with the original
 * constraints (required, options, hasMany, min/max, ...) overlaid onto the
 * options Payload builds for the text-backed stored field.
 *
 * richText: payload/shared's richText validator calls the resolved editor,
 * which a text-backed field does not have; enforce required only.
 */
export const makeEffectiveValidator = (source: EncryptedSourceField): PlaintextValidator => {
	const userValidate = 'validate' in source ? source.validate : undefined
	if (typeof userValidate === 'function') {
		return userValidate as PlaintextValidator
	}
	if (source.type === 'richText') {
		return (value, options) => {
			if ('required' in source && source.required === true && value == null) {
				return options.req.t('validation:required')
			}
			return true
		}
	}
	const stock = stockValidators[source.type] as PlaintextValidator
	return (value, options) => stock(value, { ...options, ...(source as Record<string, unknown>) })
}

const WIRE_PREFIX = 'pfe1'
const WIRE_SEGMENT = /^[A-Za-z0-9_-]+$/
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Structural wire check kept in sync with crypto/wire.ts parseWire (prefix, 5
 * base64url segments, IV/tag byte lengths). Deliberately duplicated so this
 * module, which runs inside Payload's validate pass, never imports node:crypto;
 * Buffer is a Node global and validate only runs server-side. A string merely
 * shaped like `pfe1.a.b.c.d` must not be treated as sealed, or its plaintext
 * validation would be skipped.
 */
const isSealedString = (value: unknown): boolean => {
	if (typeof value !== 'string') {
		return false
	}
	const segments = value.split('.')
	if (segments.length !== 5 || segments[0] !== WIRE_PREFIX) {
		return false
	}
	const [, keyId, iv, ct, tag] = segments as [string, string, string, string, string]
	if (![keyId, iv, ct, tag].every((segment) => WIRE_SEGMENT.test(segment))) {
		return false
	}
	return (
		Buffer.from(iv, 'base64url').length === IV_BYTES &&
		Buffer.from(tag, 'base64url').length === TAG_BYTES &&
		Buffer.from(ct, 'base64url').length > 0
	)
}

/** A `{ [locale]: sealed }` map produced by a locale=all write (M3). */
const isSealedLocaleMap = (value: unknown): boolean => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false
	}
	const entries = Object.values(value as Record<string, unknown>)
	if (entries.length === 0) {
		return false
	}
	return entries.every(
		(entry) =>
			entry == null ||
			isSealedString(entry) ||
			(Array.isArray(entry) && entry.length > 0 && entry.some(isSealedString))
	)
}

/**
 * The stash key for a value that is a sealed single string or an all-sealed
 * array, else undefined. Payload hands validate exactly the value the seal hook
 * returned, so this recomputes the same key the hook stashed under.
 */
const sealedStashKey = (value: unknown): string | undefined => {
	if (isSealedString(value)) {
		return value as string
	}
	if (Array.isArray(value) && value.length > 0 && value.every(isSealedString)) {
		return sealedArrayKey(value as string[])
	}
	return undefined
}

/**
 * The stored field's validate. The seal hook runs first (field beforeChange
 * hooks precede validate) and stashes the pre-seal plaintext on req.context
 * keyed by the sealed value, so validation happens HERE, natively: this honors
 * skipValidation (drafts) and aggregates errors with the right path and req.t,
 * which a throw from the hook cannot. Order:
 *   1. a sealed value/array whose plaintext is stashed -> validate the plaintext
 *      (fresh write); no stash -> skip (resubmitted/already-sealed, or a mixed
 *      passthrough array, already validated when first written);
 *   2. a sealed locale=all map -> skip (per-locale validation deferred);
 *   3. otherwise validate the incoming value directly (admin form state that
 *      never ran the hook, null/undefined/required).
 */
export const makeComposedValidate = (effective: PlaintextValidator): Validate => {
	return (value, options) => {
		const opts = options as Record<string, unknown> & { req?: PayloadRequest }
		const sealedKey = sealedStashKey(value)
		if (sealedKey !== undefined) {
			if (opts.req) {
				const taken = takePlaintext(opts.req, sealedKey)
				if (taken.found) {
					return effective(
						taken.plaintext,
						opts as Record<string, unknown> & { req: PayloadRequest }
					)
				}
			}
			return true
		}
		if (value != null && isSealedLocaleMap(value)) {
			return true
		}
		return effective(value, opts as Record<string, unknown> & { req: PayloadRequest })
	}
}
