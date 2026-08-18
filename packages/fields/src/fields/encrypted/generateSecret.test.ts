import { describe, expect, it } from 'vitest'
import { generateSecret, normalizeGenerate } from './generateSecret'

describe('normalizeGenerate', () => {
	it('true selects the defaults', () => {
		expect(normalizeGenerate(true, 'k')).toMatchObject({ length: 32, prefix: '' })
	})

	it('rejects out-of-range lengths and thin charsets', () => {
		expect(() => normalizeGenerate({ length: 4 }, 'k')).toThrow(/\[8, 128\]/)
		expect(() => normalizeGenerate({ length: 129 }, 'k')).toThrow(/\[8, 128\]/)
		expect(() => normalizeGenerate({ charset: 'abcab' }, 'k')).toThrow(/distinct/)
	})
})

describe('generateSecret', () => {
	it('produces prefix + length chars from the charset', async () => {
		const secret = await generateSecret(normalizeGenerate({ length: 32, prefix: 'whsec_' }, 'k'))
		expect(secret).toHaveLength(6 + 32)
		expect(secret.startsWith('whsec_')).toBe(true)
		expect(/^whsec_[A-Za-z0-9]{32}$/.test(secret)).toBe(true)
	})

	it('respects a custom charset', async () => {
		const secret = await generateSecret(
			normalizeGenerate({ charset: '0123456789', length: 16 }, 'k')
		)
		expect(/^[0-9]{16}$/.test(secret)).toBe(true)
	})

	it('does not repeat across calls', async () => {
		const [a, b] = await Promise.all([
			generateSecret(normalizeGenerate(true, 'k')),
			generateSecret(normalizeGenerate(true, 'k')),
		])
		expect(a).not.toBe(b)
	})
})
