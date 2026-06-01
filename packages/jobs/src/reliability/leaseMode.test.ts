import { describe, expect, it } from 'vitest'

import { initialLeaseTtlMs, isHeartbeatMode } from './leaseMode'
import type { ResolvedReliabilityOptions } from './options'

const base: ResolvedReliabilityOptions = {
	heartbeatIntervalMs: 100_000,
	jobLeaseTtlMs: 300_000,
	leaderId: null,
	leaderLeaseTtlMs: 30_000,
	maxRecoveries: 3,
	requireConcurrencyControl: false,
	serverlessMaxDurationMs: null,
	sweepIntervalMs: 60_000,
}

describe('leaseMode', () => {
	it('is heartbeat mode when no serverless max duration is set', () => {
		expect(isHeartbeatMode(base)).toBe(true)
		expect(isHeartbeatMode({ ...base, serverlessMaxDurationMs: 800_000 })).toBe(false)
	})

	it('stamps jobLeaseTtlMs in heartbeat mode', () => {
		expect(initialLeaseTtlMs(base)).toBe(300_000)
	})

	it('stamps the serverless max duration in serverless mode', () => {
		expect(initialLeaseTtlMs({ ...base, serverlessMaxDurationMs: 800_000 })).toBe(800_000)
	})
})
