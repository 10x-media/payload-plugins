import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const WIRE_PREFIX = 'pfe1'
/** GCM standard nonce size; unique per seal via randomBytes. */
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

export class MalformedCiphertextError extends Error {
	constructor(reason: string) {
		super(`@10x-media/fields: malformed ciphertext: ${reason}`)
		this.name = 'MalformedCiphertextError'
	}
}

export class UnknownKeyIdError extends Error {
	readonly keyId: string
	constructor(keyId: string) {
		super(`@10x-media/fields: no key configured for keyId '${keyId}'`)
		this.name = 'UnknownKeyIdError'
		this.keyId = keyId
	}
}

export class AuthenticationFailedError extends Error {
	readonly keyId: string
	constructor(keyId: string) {
		super(`@10x-media/fields: ciphertext failed authentication (keyId '${keyId}')`)
		this.name = 'AuthenticationFailedError'
		this.keyId = keyId
	}
}

/**
 * The ciphertext authenticated (correct key + AAD + tag) but the decrypted
 * bytes are not valid JSON. Distinct from AuthenticationFailedError: auth
 * succeeded, so this is non-retryable corruption, not a wrong key or AAD.
 */
export class CorruptPlaintextError extends Error {
	readonly keyId: string
	constructor(keyId: string, cause: unknown) {
		super(
			`@10x-media/fields: ciphertext authenticated but plaintext is not valid JSON (keyId '${keyId}')`
		)
		this.name = 'CorruptPlaintextError'
		this.keyId = keyId
		this.cause = cause
	}
}

/**
 * Cheap shape check used on hot paths (hooks run per field per document).
 * A full parse only happens inside unseal.
 */
export const isSealed = (value: unknown): value is string =>
	typeof value === 'string' && value.startsWith(`${WIRE_PREFIX}.`) && value.split('.').length === 5

export interface SealArgs {
	aad: string
	key: Buffer
	keyId: string
	plaintext: unknown
}

/**
 * JSON.stringify -> AES-256-GCM -> `pfe1.<keyId>.<iv>.<ct>.<tag>` (base64url).
 * The JSON round-trip preserves JS types (number, boolean, arrays, objects);
 * AAD binds the ciphertext to its collection.field[.locale] slot.
 */
export const seal = ({ aad, key, keyId, plaintext }: SealArgs): string => {
	const iv = randomBytes(IV_LENGTH)
	const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH })
	cipher.setAAD(Buffer.from(aad, 'utf8'))
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(plaintext), 'utf8'),
		cipher.final(),
	])
	const tag = cipher.getAuthTag()
	return [
		WIRE_PREFIX,
		keyId,
		iv.toString('base64url'),
		ciphertext.toString('base64url'),
		tag.toString('base64url'),
	].join('.')
}

export interface ParsedWire {
	ciphertext: Buffer
	iv: Buffer
	keyId: string
	tag: Buffer
}

export const parseWire = (value: string): ParsedWire => {
	const segments = value.split('.')
	if (segments.length !== 5) {
		throw new MalformedCiphertextError(`expected 5 segments, got ${segments.length}`)
	}
	const [prefix, keyId, ivRaw, ctRaw, tagRaw] = segments as [string, string, string, string, string]
	if (prefix !== WIRE_PREFIX) {
		throw new MalformedCiphertextError(`unknown prefix '${prefix}'`)
	}
	if (!SEGMENT_PATTERN.test(keyId)) {
		throw new MalformedCiphertextError('invalid keyId segment')
	}
	for (const segment of [ivRaw, ctRaw, tagRaw]) {
		if (!SEGMENT_PATTERN.test(segment)) {
			throw new MalformedCiphertextError('invalid base64url segment')
		}
	}
	const iv = Buffer.from(ivRaw, 'base64url')
	const ciphertext = Buffer.from(ctRaw, 'base64url')
	const tag = Buffer.from(tagRaw, 'base64url')
	if (iv.length !== IV_LENGTH) {
		throw new MalformedCiphertextError(`iv must be ${IV_LENGTH} bytes`)
	}
	if (tag.length !== TAG_LENGTH) {
		throw new MalformedCiphertextError(`tag must be ${TAG_LENGTH} bytes`)
	}
	if (ciphertext.length === 0) {
		throw new MalformedCiphertextError('empty ciphertext')
	}
	return { ciphertext, iv, keyId, tag }
}

/**
 * Decrypts with the key selected by the embedded keyId, trying each AAD
 * candidate in order. Multiple candidates exist only for localized fields,
 * where Payload's fallbackLocale hoisting and locale=all hook execution hide
 * which locale a value belongs to (see plan Deviation 3). A failed candidate
 * costs one GCM operation; candidates are bounded by the configured locales.
 */
export const unseal = (
	value: string,
	dataKeys: ReadonlyMap<string, Buffer>,
	aadCandidates: readonly string[]
): unknown => {
	const { ciphertext, iv, keyId, tag } = parseWire(value)
	const key = dataKeys.get(keyId)
	if (!key) {
		throw new UnknownKeyIdError(keyId)
	}
	for (const aad of aadCandidates) {
		let json: string
		try {
			const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH })
			decipher.setAAD(Buffer.from(aad, 'utf8'))
			decipher.setAuthTag(tag)
			json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
		} catch {
			// GCM auth failed for this candidate; try the next
			continue
		}
		// Auth succeeded: a JSON parse failure is non-retryable corruption, not an
		// auth failure. Do not fall through to the next candidate or the final throw.
		try {
			return JSON.parse(json)
		} catch (cause) {
			throw new CorruptPlaintextError(keyId, cause)
		}
	}
	throw new AuthenticationFailedError(keyId)
}
