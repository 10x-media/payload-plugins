import type { Payload } from 'payload'
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
 * Fetches one encrypted field's stored ciphertext by path, bypassing the
 * decrypt-on-read pipeline (and the write-only response strip). Returns null
 * when the field holds no value. This is THE supported way to use a
 * `protection: 'writeOnly'` secret server-side:
 *
 * ```ts
 * const secret = await readEncryptedField(payload, { global: 'settings', path: 'smtp.password' })
 * const password = await secret?.decrypt()
 * ```
 *
 * Server-only and access-unchecked by design: calling it is the deliberate
 * act. Guard call sites accordingly, and never forward the result to a client.
 */
export const readEncryptedField = async (
	payload: Payload,
	args: ReadEncryptedFieldArgs
): Promise<EncryptedFieldHandle | null> => {
	const { collection, global, id, locale, path } = args
	resolveEncryptedField(payload, args)
	if (collection && id == null) {
		throw new Error(
			`@10x-media/fields: readEncryptedField needs an 'id' to read '${collection}.${path}'`
		)
	}
	const localeArg = locale ? { locale: locale as never } : {}
	const doc = collection
		? await payload.findByID({
				collection: collection as never,
				context: { [ENCRYPTED_CONTEXT_KEY]: 'raw' },
				depth: 0,
				id: id as number | string,
				overrideAccess: true,
				...localeArg,
			})
		: await payload.findGlobal({
				context: { [ENCRYPTED_CONTEXT_KEY]: 'raw' },
				depth: 0,
				overrideAccess: true,
				slug: global as never,
				...localeArg,
			})
	const value = getAtPath(doc as unknown as Record<string, unknown>, path)
	if (value == null) {
		return null
	}
	const target: EncryptedFieldTarget = { collection, global, locale, path }
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
