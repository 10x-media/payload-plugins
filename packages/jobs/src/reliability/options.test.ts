import { describe, expect, it } from 'vitest'

import { resolveReliabilityOptions } from './options'

describe('resolveReliabilityOptions', () => {
	it('returns null when reliability is undefined or false', () => {
		expect(resolveReliabilityOptions(undefined)).toBeNull()
		expect(resolveReliabilityOptions(false)).toBeNull()
	})

	it('applies all defaults for an empty object', () => {
		expect(resolveReliabilityOptions({})).toEqual({
			leaderId: null,
			leaderLeaseTtlMs: 30_000,
			maxRecoveries: 3,
		})
	})

	it('treats true as enabling with all defaults (same as {})', () => {
		expect(resolveReliabilityOptions(true)).toEqual(resolveReliabilityOptions({}))
	})

	it('honors explicit overrides', () => {
		const resolved = resolveReliabilityOptions({
			leaderId: 'node-a',
			leaderLeaseTtlMs: 5_000,
			maxRecoveries: 5,
		})
		expect(resolved).toEqual({ leaderId: 'node-a', leaderLeaseTtlMs: 5_000, maxRecoveries: 5 })
	})
})
