import { describe, expect, it } from 'vitest'
import { MIN_SECRET_BYTES, SECRET_PREFIX } from '../constants'
import { validateWhsec } from './secretFields'

describe('validateWhsec', () => {
	it('accepts an absent secret, which is a subscription that delivers unsigned', () => {
		expect(validateWhsec(undefined)).toBe(true)
		expect(validateWhsec(null)).toBe(true)
	})

	/**
	 * Not the same as absent. `encryptedField` reads a write-only empty string as a clear and
	 * stores null, so passing it here would create a subscription with no secret for a caller who
	 * plainly meant to supply one, and every delivery would go out unsigned.
	 */
	it('rejects an explicitly empty secret instead of treating it as absent', () => {
		expect(validateWhsec('')).toBe('the secret is empty')
	})

	it('accepts a canonical secret', () => {
		expect(validateWhsec(`${SECRET_PREFIX}${'A'.repeat(44)}`)).toBe(true)
	})

	it('reports the reason a malformed secret was refused', () => {
		expect(validateWhsec(`${SECRET_PREFIX}not base64!`)).toContain('padded base64')
		expect(validateWhsec(`${SECRET_PREFIX}AAAA`)).toContain(String(MIN_SECRET_BYTES))
	})
})
