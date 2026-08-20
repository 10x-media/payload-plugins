import type { Payload, PayloadRequest } from 'payload'
import { withRawEncrypted } from '../rawRead'
import { ENCRYPTED_CONTEXT_KEY } from '../types'
import {
	decryptFieldValue,
	type EncryptedFieldTarget,
	resolveEncryptedField,
} from './decryptFieldValue'
import { getAtPath } from './pageThrough'

export interface ReadEncryptedFieldArgs extends EncryptedFieldTarget {
	/** Document id; required with `collection`, ignored with `global`. */
	id?: number | string
	/**
	 * Request to read on. Given one, the read joins its transaction and sees the
	 * caller's uncommitted writes, which is what a secret written and used inside
	 * the same operation needs. Omitted, the read runs on its own request and
	 * therefore outside any transaction in progress. The request is left exactly
	 * as it was found.
	 */
	req?: PayloadRequest
}

/**
 * A deliberately read encrypted value. `ciphertext` is the raw stored wire
 * string (an array for `hasMany` fields), safe to hold in a cache; `decrypt()`
 * resolves keys at call time, so plaintext exists only for the moment it is
 * used. Rehydrate a persisted ciphertext later via `decryptFieldValue`.
 */
export interface EncryptedFieldHandle {
	ciphertext: string | string[]
	decrypt(): Promise<unknown>
}

/**
 * Which locale this read resolves at. An explicit argument wins, then the
 * request's, since the read joins it.
 *
 * `all` is not a locale but a request for every locale at once, which hands
 * back a `{ [locale]: value }` map where a handle addresses a single value. It
 * falls back to the default locale, which is what this helper reads with no
 * request at all: passing a `req` picks the transaction to read in, never which
 * value comes back.
 */
const readLocale = (
	payload: Payload,
	locale: string | undefined,
	req: PayloadRequest | undefined
): string | undefined => {
	if (locale) {
		return locale
	}
	if (!req?.locale) {
		return undefined
	}
	if (req.locale !== 'all') {
		return req.locale
	}
	return payload.config.localization ? payload.config.localization.defaultLocale : undefined
}

/**
 * Fetches one encrypted field's stored ciphertext by path, bypassing the
 * decrypt-on-read pipeline (and the write-only response strip). Returns null
 * when the field holds no value, and throws when the document itself is
 * missing. This is THE supported way to use a `protection: 'writeOnly'` secret
 * server-side:
 *
 * ```ts
 * const secret = await readEncryptedField(payload, { global: 'settings', path: 'smtp.password' })
 * const password = await secret?.decrypt()
 * ```
 *
 * One document per call. To recover a field across many documents, run your own
 * query inside `withRawEncrypted` and pass each stored value to
 * `decryptFieldValue`; that keeps it to a single query and gives you the rest of
 * each document as well.
 *
 * Server-only and access-unchecked by design: calling it is the deliberate
 * act. Guard call sites accordingly, and never forward the result to a client.
 */
export const readEncryptedField = async (
	payload: Payload,
	args: ReadEncryptedFieldArgs
): Promise<EncryptedFieldHandle | null> => {
	const { collection, global, id, locale, path, req } = args
	resolveEncryptedField(payload, args)
	if (collection && id == null) {
		throw new Error(
			`@10x-media/fields: readEncryptedField needs an 'id' to read '${collection}.${path}'`
		)
	}
	const resolvedLocale = readLocale(payload, locale, req)
	const localeArg = resolvedLocale ? { locale: resolvedLocale as never } : {}
	// Without a request there is nothing to restore, so the mode rides on the
	// operation and Payload's own throwaway request carries it.
	const modeArg = req ? {} : { context: { [ENCRYPTED_CONTEXT_KEY]: 'raw' } }
	const read = () =>
		collection
			? payload.findByID({
					collection: collection as never,
					depth: 0,
					id: id as number | string,
					overrideAccess: true,
					req,
					...modeArg,
					...localeArg,
				})
			: payload.findGlobal({
					depth: 0,
					overrideAccess: true,
					req,
					slug: global as never,
					...modeArg,
					...localeArg,
				})
	const doc = req ? await withRawEncrypted(req, read) : await read()
	const value = getAtPath(doc as unknown as Record<string, unknown>, path)
	if (value == null) {
		return null
	}
	const target: EncryptedFieldTarget = { collection, global, locale: resolvedLocale, path }
	if (Array.isArray(value)) {
		const items = value.filter((item): item is string => typeof item === 'string')
		if (items.length === 0) {
			return null
		}
		return {
			ciphertext: items,
			decrypt: () =>
				Promise.all(items.map((item) => decryptFieldValue(payload, { ...target, value: item }))),
		}
	}
	if (typeof value !== 'string') {
		throw new Error(
			`@10x-media/fields: expected a stored wire string at '${(collection ?? global) as string}.${path}', got ${typeof value}`
		)
	}
	return {
		ciphertext: value,
		decrypt: () => decryptFieldValue(payload, { ...target, value }),
	}
}
