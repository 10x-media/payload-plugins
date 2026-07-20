import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { seal } from '../crypto/wire'
import { staleIn } from './rotateEncryptedFields'

const key = randomBytes(32)
const sealedUnder = (keyId: string): string =>
	seal({ aad: 'people.secret', key, keyId, plaintext: 'hello' })

describe('staleIn', () => {
	it('is stale when a sealed value carries a non-active keyId', () => {
		expect(staleIn(sealedUnder('k0'), 'k1')).toBe(true)
	})

	it('is not stale when a sealed value carries the active keyId', () => {
		expect(staleIn(sealedUnder('k1'), 'k1')).toBe(false)
	})

	it('is not stale for plaintext, undefined, or null', () => {
		expect(staleIn('plaintext', 'k1')).toBe(false)
		expect(staleIn(undefined, 'k1')).toBe(false)
		expect(staleIn(null, 'k1')).toBe(false)
	})

	it('is stale when any locale in a locale map carries a non-active keyId', () => {
		const localeMap = { de: sealedUnder('k1'), en: sealedUnder('k0') }
		expect(staleIn(localeMap, 'k1')).toBe(true)
	})
})
