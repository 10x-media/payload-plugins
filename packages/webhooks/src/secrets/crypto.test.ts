import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { CIPHER_PREFIX } from '../constants'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto'
import { generateSecret } from './format'

/**
 * Payload derives its cipher key as sha256(config.secret) hex-sliced to 32 chars and encrypts
 * with aes-256-ctr; this mirrors that exactly so the unit tests exercise the real wire shape
 * without booting Payload.
 */
const fakePayload = (secret = 'test-secret-for-webhooks'): Payload => {
	const key = createHash('sha256').update(secret).digest('hex').slice(0, 32)
	return {
		encrypt: (text: string) => {
			const iv = randomBytes(16)
			const cipher = createCipheriv('aes-256-ctr', key, iv)
			return `${iv.toString('hex')}${cipher.update(text, 'utf8', 'hex')}${cipher.final('hex')}`
		},
		decrypt: (hash: string) => {
			const decipher = createDecipheriv('aes-256-ctr', key, Buffer.from(hash.slice(0, 32), 'hex'))
			return `${decipher.update(hash.slice(32), 'hex', 'utf8')}${decipher.final('utf8')}`
		},
		logger: { warn: () => undefined },
	} as unknown as Payload
}

describe('encryptSecret', () => {
	const payload = fakePayload()

	it('tags its output so ciphertext is recognizable', () => {
		const stored = encryptSecret(payload, generateSecret())
		expect(stored.startsWith(CIPHER_PREFIX)).toBe(true)
		expect(isEncryptedSecret(stored)).toBe(true)
	})

	it('never leaves the plaintext secret in the stored value', () => {
		const plaintext = generateSecret()
		const stored = encryptSecret(payload, plaintext)
		expect(stored).not.toContain(plaintext)
		expect(stored).not.toContain(plaintext.slice('whsec_'.length))
	})

	it('is idempotent, so an update cannot double-encrypt', () => {
		const stored = encryptSecret(payload, generateSecret())
		expect(encryptSecret(payload, stored)).toBe(stored)
	})

	it('produces a different ciphertext each time for the same input', () => {
		const plaintext = generateSecret()
		expect(encryptSecret(payload, plaintext)).not.toBe(encryptSecret(payload, plaintext))
	})
})

describe('decryptSecret', () => {
	const payload = fakePayload()

	it('round-trips a generated secret', () => {
		const plaintext = generateSecret()
		expect(decryptSecret(payload, encryptSecret(payload, plaintext))).toBe(plaintext)
	})

	it('round-trips across separate payload instances sharing a secret', () => {
		const plaintext = generateSecret()
		const stored = encryptSecret(fakePayload('shared'), plaintext)
		expect(decryptSecret(fakePayload('shared'), stored)).toBe(plaintext)
	})

	it('passes through a legacy plaintext secret that was never encrypted', () => {
		const plaintext = generateSecret()
		expect(decryptSecret(payload, plaintext)).toBe(plaintext)
	})

	it('returns null rather than garbage when the key changed', () => {
		const stored = encryptSecret(fakePayload('old-payload-secret'), generateSecret())
		expect(decryptSecret(fakePayload('new-payload-secret'), stored)).toBeNull()
	})

	it('returns null for the mask and other non-secret values', () => {
		expect(decryptSecret(payload, '__redacted__')).toBeNull()
		expect(decryptSecret(payload, '')).toBeNull()
	})

	it('returns null for a malformed ciphertext body', () => {
		expect(decryptSecret(payload, `${CIPHER_PREFIX}not-hex`)).toBeNull()
	})
})

describe('isEncryptedSecret', () => {
	it('rejects plaintext secrets, the mask, and non-strings', () => {
		expect(isEncryptedSecret(generateSecret())).toBe(false)
		expect(isEncryptedSecret('__redacted__')).toBe(false)
		expect(isEncryptedSecret(undefined)).toBe(false)
		expect(isEncryptedSecret(null)).toBe(false)
	})

	/**
	 * The tag alone answers "has this already been encrypted?", which is the only question this
	 * predicate exists for. Whether the body is recoverable is `decryptSecret`'s call: answering
	 * "not encrypted" here for a tagged but corrupt value would send it back through the cipher a
	 * second time instead of reporting it as unreadable.
	 */
	it('accepts anything carrying the tag, leaving the body to decryptSecret', () => {
		expect(isEncryptedSecret(`${CIPHER_PREFIX}short`)).toBe(true)
		expect(isEncryptedSecret(`${CIPHER_PREFIX}${'z'.repeat(48)}`)).toBe(true)
	})

	it('does not re-encrypt a tagged but corrupt value', () => {
		const corrupt = `${CIPHER_PREFIX}${'z'.repeat(48)}`
		expect(encryptSecret(fakePayload(), corrupt)).toBe(corrupt)
		expect(decryptSecret(fakePayload(), corrupt)).toBeNull()
	})
})
