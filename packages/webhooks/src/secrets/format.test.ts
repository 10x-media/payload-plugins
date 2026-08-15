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
		expect(() => normalizeSecret('__redacted__')).toThrow(/must be base64/)
		expect(() => normalizeSecret(`${SECRET_PREFIX}not base64!`)).toThrow(/must be base64/)
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
		expect(isNormalizedSecret('__redacted__')).toBe(false)
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
