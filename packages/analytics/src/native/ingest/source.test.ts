import { describe, expect, it } from 'vitest'
import { deriveSource } from './source'

describe('deriveSource', () => {
	it('returns Direct when there is no referrer', () => {
		expect(deriveSource(undefined, 'example.com')).toBe('Direct')
		expect(deriveSource('', 'example.com')).toBe('Direct')
	})

	it('returns the bare referrer host without www', () => {
		expect(deriveSource('https://www.google.com/search?q=x', 'example.com')).toBe('google.com')
		expect(deriveSource('https://t.co/abc', 'example.com')).toBe('t.co')
	})

	it('treats a same-site referrer as Direct (internal navigation)', () => {
		expect(deriveSource('https://example.com/pricing', 'example.com')).toBe('Direct')
		expect(deriveSource('https://www.example.com/x', 'example.com')).toBe('Direct')
	})

	it('returns Direct for an unparseable referrer', () => {
		expect(deriveSource('not a url', 'example.com')).toBe('Direct')
	})
})
