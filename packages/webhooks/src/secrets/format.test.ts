import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MIN_SECRET_BYTES, SECRET_BYTES, SECRET_PREFIX } from '../constants'
import {
	generateSecret,
	InvalidSecretError,
	isNormalizedSecret,
	normalizeSecret,
	secretKey,
} from './format'

describe('generateSecret', () => {
	it('produces a prefixed base64 secret over the configured entropy', () => {
		const secret = generateSecret()
		expect(secret.startsWith(SECRET_PREFIX)).toBe(true)
		expect(secretKey(secret)).toHaveLength(SECRET_BYTES)
	})

	it('is unique per call', () => {
		expect(generateSecret()).not.toBe(generateSecret())
	})

	it('round-trips through normalizeSecret unchanged', () => {
		const secret = generateSecret()
		expect(normalizeSecret(secret)).toBe(secret)
	})
})

describe('normalizeSecret', () => {
	const body = randomBytes(SECRET_BYTES).toString('base64')

	it('adds the prefix to a bare base64 secret', () => {
		expect(normalizeSecret(body)).toBe(`${SECRET_PREFIX}${body}`)
	})

	it('leaves an already-prefixed secret alone', () => {
		expect(normalizeSecret(`${SECRET_PREFIX}${body}`)).toBe(`${SECRET_PREFIX}${body}`)
	})

	it('collapses a doubly-prefixed secret rather than storing it malformed', () => {
		expect(normalizeSecret(`${SECRET_PREFIX}${SECRET_PREFIX}${body}`)).toBe(
			`${SECRET_PREFIX}${body}`
		)
	})

	it('trims surrounding whitespace from a pasted secret', () => {
		expect(normalizeSecret(`  ${SECRET_PREFIX}${body}\n`)).toBe(`${SECRET_PREFIX}${body}`)
	})

	it('rejects an empty secret', () => {
		expect(() => normalizeSecret('')).toThrow(InvalidSecretError)
		expect(() => normalizeSecret('   ')).toThrow(InvalidSecretError)
	})

	it('rejects a prefix with no key material', () => {
		expect(() => normalizeSecret(SECRET_PREFIX)).toThrow(/no key material/)
	})

	it('rejects non-base64 material', () => {
		expect(() => normalizeSecret('not-a-secret')).toThrow(/padded base64/)
		expect(() => normalizeSecret(`${SECRET_PREFIX}not base64!`)).toThrow(/padded base64/)
	})

	it('rejects a ragged length rather than decoding the leftover bits away', () => {
		// 33 base64 characters: a group of three plus one stray, which `Buffer.from` would happily
		// truncate. Accepting it would mean a mistyped or clipped paste silently becomes a shorter
		// key, and that two different strings can derive the very same one.
		expect(() => normalizeSecret('A'.repeat(33))).toThrow(/padded base64/)
		expect(() => normalizeSecret(`${SECRET_PREFIX}${'A'.repeat(43)}`)).toThrow(/padded base64/)
	})

	it('rejects misplaced or over-long padding', () => {
		expect(() => normalizeSecret(`${'A'.repeat(24)}===`)).toThrow(/padded base64/)
		expect(() => normalizeSecret(`${'A'.repeat(22)}=A`)).toThrow(/padded base64/)
	})

	/**
	 * The group-structure check alone still admits aliases: the final group's unused low bits are
	 * not required to be zero, so two different strings decode to byte-identical key material.
	 */
	it('rejects a non-canonical alias that decodes to the same key', () => {
		const canonical = `${'A'.repeat(22)}==`
		const alias = `${'A'.repeat(21)}B==`
		expect(Buffer.from(alias, 'base64').equals(Buffer.from(canonical, 'base64'))).toBe(true)
		expect(alias).not.toBe(canonical)

		expect(normalizeSecret(canonical)).toBe(`${SECRET_PREFIX}${canonical}`)
		expect(() => normalizeSecret(alias)).toThrow(/canonically encoded/)
	})

	it('accepts both padded final-group shapes', () => {
		// 22 characters + '==' decodes to 16 bytes, 23 + '=' to 17: the two legal tail shapes.
		expect(secretKey(normalizeSecret(`${'A'.repeat(22)}==`))).toHaveLength(16)
		expect(secretKey(normalizeSecret(`${'A'.repeat(23)}=`))).toHaveLength(17)
	})

	it('accepts a legacy 48-character hex secret, which is already canonical base64', () => {
		const legacy = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'
		expect(normalizeSecret(legacy)).toBe(`${SECRET_PREFIX}${legacy}`)
	})

	it('rejects material below the byte floor', () => {
		const short = randomBytes(MIN_SECRET_BYTES - 1).toString('base64')
		expect(() => normalizeSecret(short)).toThrow(/at least 16/)
	})

	it('accepts material exactly at the byte floor', () => {
		const atFloor = randomBytes(MIN_SECRET_BYTES).toString('base64')
		expect(secretKey(normalizeSecret(atFloor))).toHaveLength(MIN_SECRET_BYTES)
	})

	it('carries a bare reason for callers composing their own message', () => {
		try {
			normalizeSecret('!!')
			expect.unreachable()
		} catch (err) {
			expect(err).toBeInstanceOf(InvalidSecretError)
			expect((err as InvalidSecretError).reason).not.toContain('@10x-media')
		}
	})
})

describe('isNormalizedSecret', () => {
	it('accepts a generated secret', () => {
		expect(isNormalizedSecret(generateSecret())).toBe(true)
	})

	it('rejects unprefixed, malformed, and non-string values', () => {
		expect(isNormalizedSecret(randomBytes(SECRET_BYTES).toString('base64'))).toBe(false)
		expect(isNormalizedSecret('not-a-secret')).toBe(false)
		expect(isNormalizedSecret(undefined)).toBe(false)
		expect(isNormalizedSecret(null)).toBe(false)
		expect(isNormalizedSecret(42)).toBe(false)
	})
})

describe('secretKey', () => {
	it('returns the base64-decoded bytes, not the ascii of the secret', () => {
		const raw = randomBytes(SECRET_BYTES)
		const secret = `${SECRET_PREFIX}${raw.toString('base64')}`
		expect(secretKey(secret).equals(raw)).toBe(true)
		expect(secretKey(secret).equals(Buffer.from(secret.slice(SECRET_PREFIX.length)))).toBe(false)
	})

	it('derives the same key with or without the prefix', () => {
		const body = randomBytes(SECRET_BYTES).toString('base64')
		expect(secretKey(body).equals(secretKey(`${SECRET_PREFIX}${body}`))).toBe(true)
	})
})
