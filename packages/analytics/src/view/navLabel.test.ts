import { describe, expect, it } from 'vitest'
import { resolveNavLabel } from './navLabel'

describe('resolveNavLabel', () => {
	it('falls back to the plugin label when no override is set', () => {
		expect(resolveNavLabel({ language: 'de', fallback: 'Analytics' })).toBe('Analytics')
	})

	it('uses a plain string override', () => {
		expect(resolveNavLabel({ label: 'Traffic', language: 'de', fallback: 'Analytics' })).toBe(
			'Traffic'
		)
	})

	it('reads the map entry for the admin language', () => {
		expect(
			resolveNavLabel({
				label: { de: 'Statistiken', en: 'Traffic' },
				language: 'de',
				fallback: 'Analytics',
			})
		).toBe('Statistiken')
	})

	it('falls back to the map English entry for an unlisted language', () => {
		expect(
			resolveNavLabel({ label: { en: 'Traffic' }, language: 'ko', fallback: 'Analytics' })
		).toBe('Traffic')
	})

	// Payload reads a label map the same way: the language, the install's fallback, then on.
	it("reads the install's fallback language before English", () => {
		expect(
			resolveNavLabel({
				label: { de: 'Statistiken', en: 'Traffic' },
				language: 'ko',
				fallbackLanguage: 'de',
				fallback: 'Analytics',
			})
		).toBe('Statistiken')
	})

	it('treats a blank override as unset', () => {
		expect(resolveNavLabel({ label: '   ', language: 'en', fallback: 'Analytics' })).toBe(
			'Analytics'
		)
		expect(
			resolveNavLabel({ label: { en: '', de: '  ' }, language: 'de', fallback: 'Analytics' })
		).toBe('Analytics')
	})
})
