import { describe, expect, it } from 'vitest'
import { applyRegistryConfig } from './applyRegistryConfig'

type Def = { type: string; label: string }

const seed = (): Map<string, Def> =>
	new Map([
		['a', { type: 'a', label: 'A' }],
		['b', { type: 'b', label: 'B' }],
	])

describe('applyRegistryConfig', () => {
	it('removes a type on false', () => {
		const out = applyRegistryConfig(seed(), { a: false })
		expect(out.has('a')).toBe(false)
		expect(out.has('b')).toBe(true)
	})

	it('keeps the seeded default on true (and no-ops when none exists)', () => {
		const out = applyRegistryConfig(seed(), { a: true, missing: true })
		expect(out.get('a')).toEqual({ type: 'a', label: 'A' })
		expect(out.has('missing')).toBe(false)
	})

	it('adds a new type from a definition', () => {
		const out = applyRegistryConfig(seed(), { c: { type: 'c', label: 'C' } })
		expect(out.get('c')).toEqual({ type: 'c', label: 'C' })
	})

	it('replaces an existing type, forcing type to the config key so the slot cannot be renamed', () => {
		const out = applyRegistryConfig(seed(), { a: { type: 'renamed', label: 'A2' } })
		expect(out.get('a')).toEqual({ type: 'a', label: 'A2' })
		expect(out.has('renamed')).toBe(false)
	})

	it('mutates and returns the same map instance', () => {
		const registry = seed()
		const out = applyRegistryConfig(registry, { a: false })
		expect(out).toBe(registry)
	})

	it('applies an empty config as a no-op', () => {
		const out = applyRegistryConfig(seed(), {})
		expect([...out.keys()]).toEqual(['a', 'b'])
	})
})
