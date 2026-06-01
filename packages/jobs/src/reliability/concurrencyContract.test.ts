import { describe, expect, it, vi } from 'vitest'

import { enforceConcurrencyControl, withIdempotencyKey } from './concurrencyContract'
import type { ResolvedReliabilityOptions } from './options'

const options = (over: Partial<ResolvedReliabilityOptions> = {}): ResolvedReliabilityOptions => ({
	heartbeatIntervalMs: 100_000,
	jobLeaseTtlMs: 300_000,
	leaderId: null,
	leaderLeaseTtlMs: 30_000,
	maxRecoveries: 3,
	requireConcurrencyControl: false,
	serverlessMaxDurationMs: null,
	sweepIntervalMs: 60_000,
	...over,
})

describe('enforceConcurrencyControl', () => {
	it('does nothing when not required', () => {
		expect(() => enforceConcurrencyControl({}, options())).not.toThrow()
	})

	it('passes when required and enabled', () => {
		expect(() =>
			enforceConcurrencyControl(
				{ jobs: { enableConcurrencyControl: true } },
				options({ requireConcurrencyControl: true })
			)
		).not.toThrow()
	})

	it('throws when required but not enabled', () => {
		expect(() =>
			enforceConcurrencyControl({ jobs: {} }, options({ requireConcurrencyControl: true }))
		).toThrow(/enableConcurrencyControl/)
	})
})

describe('withIdempotencyKey', () => {
	it('runs the handler once per key and skips the second time', async () => {
		const store = new Map<string, true>()
		const idemStore = {
			has: (k: string) => Promise.resolve(store.has(k)),
			mark: (k: string) => {
				store.set(k, true)
				return Promise.resolve()
			},
		}
		const effect = vi.fn((_args: { job: { id: number } }) =>
			Promise.resolve({ output: { ran: true } })
		)
		const wrapped = withIdempotencyKey(effect, { keyFor: () => 'k1', store: idemStore })

		const first = await wrapped({ job: { id: 1 } })
		const second = await wrapped({ job: { id: 1 } })

		expect(effect).toHaveBeenCalledTimes(1)
		expect(first).toEqual({ output: { ran: true } })
		expect(second).toEqual({ output: {} })
	})
})
