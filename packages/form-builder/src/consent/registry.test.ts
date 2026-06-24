import { describe, expect, it } from 'vitest'
import type { AnyConsentSource } from './defineConsentSource'
import { resolveConsentSources } from './registry'

const noop = () => ({ links: [] })

const privacySource: AnyConsentSource = { type: 'privacy', label: 'Privacy Policy', resolve: noop }
const termsSource: AnyConsentSource = { type: 'terms', label: 'Terms of Service', resolve: noop }
const cookieSource: AnyConsentSource = { type: 'cookie', label: 'Cookie Policy', resolve: noop }

const defaults: Record<string, AnyConsentSource> = {
	privacy: privacySource,
	terms: termsSource,
}

describe('resolveConsentSources', () => {
	it('returns all defaults when config is empty', () => {
		const registry = resolveConsentSources(defaults)
		expect(registry.size).toBe(2)
		expect(registry.get('privacy')).toBe(privacySource)
		expect(registry.get('terms')).toBe(termsSource)
	})

	it('removes a built-in when set to false', () => {
		const registry = resolveConsentSources(defaults, { privacy: false })
		expect(registry.has('privacy')).toBe(false)
		expect(registry.has('terms')).toBe(true)
	})

	it('keeps a built-in when set to true', () => {
		const registry = resolveConsentSources(defaults, { privacy: true })
		expect(registry.get('privacy')).toBe(privacySource)
		expect(registry.size).toBe(2)
	})

	it('true is a no-op for a type with no default', () => {
		const registry = resolveConsentSources(defaults, { unknown: true })
		expect(registry.has('unknown')).toBe(false)
		expect(registry.size).toBe(2)
	})

	it('adds a new definition that is not in defaults', () => {
		const registry = resolveConsentSources(defaults, { cookie: cookieSource })
		expect(registry.get('cookie')).toBe(cookieSource)
		expect(registry.size).toBe(3)
	})

	it('replaces an existing built-in with a new definition', () => {
		const custom: AnyConsentSource = { type: 'privacy', label: 'Custom Privacy', resolve: noop }
		const registry = resolveConsentSources(defaults, { privacy: custom })
		expect(registry.get('privacy')).toBe(custom)
		expect(registry.size).toBe(2)
	})

	it('handles multiple operations together', () => {
		const registry = resolveConsentSources(defaults, {
			privacy: false,
			cookie: cookieSource,
		})
		expect(registry.has('privacy')).toBe(false)
		expect(registry.get('terms')).toBe(termsSource)
		expect(registry.get('cookie')).toBe(cookieSource)
		expect(registry.size).toBe(2)
	})
})
