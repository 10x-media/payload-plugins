import { describe, expect, it } from 'vitest'

import { resolveReliabilityOptions } from './options'

describe('resolveReliabilityOptions', () => {
	it('returns null when reliability is undefined or false', () => {
		expect(resolveReliabilityOptions(undefined)).toBeNull()
		expect(resolveReliabilityOptions(false)).toBeNull()
	})

	it('applies all defaults for an empty object', () => {
		const resolved = resolveReliabilityOptions({})
		expect(resolved).not.toBeNull()
		expect(resolved?.jobLeaseTtlMs).toBe(300_000)
		expect(resolved?.heartbeatIntervalMs).toBe(100_000)
		expect(resolved?.sweepIntervalMs).toBe(60_000)
		expect(resolved?.maxRecoveries).toBe(3)
		expect(resolved?.leaderLeaseTtlMs).toBe(30_000)
		expect(resolved?.serverlessMaxDurationMs).toBeNull()
	})

	it('derives heartbeatIntervalMs from jobLeaseTtlMs when not given', () => {
		expect(resolveReliabilityOptions({ jobLeaseTtlMs: 30_000 })?.heartbeatIntervalMs).toBe(10_000)
	})

	it('honors explicit overrides', () => {
		const resolved = resolveReliabilityOptions({
			heartbeatIntervalMs: 5_000,
			jobLeaseTtlMs: 30_000,
			maxRecoveries: 5,
			serverless: { maxDurationMs: 800_000 },
		})
		expect(resolved?.heartbeatIntervalMs).toBe(5_000)
		expect(resolved?.maxRecoveries).toBe(5)
		expect(resolved?.serverlessMaxDurationMs).toBe(800_000)
	})
})
