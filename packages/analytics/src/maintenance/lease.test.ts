import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStateStore } from '../native/store/memory/memoryState'
import { leaseKey } from '../native/store/state'
import { type Lease, underLease } from './lease'

const leaseOn = (state: ReturnType<typeof memoryStateStore>, owner: string, ttlMs: number) => {
	const key = leaseKey('analytics-sync')
	return {
		claim: () => state.claim(key, owner, ttlMs),
		release: async () => {
			await state.release(key, owner)
		},
	} satisfies Lease
}

describe('underLease', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('runs the work unguarded where no state store keeps leases', async () => {
		const warn = vi.fn()
		expect(await underLease({ lease: undefined, ttlMs: 60_000, warn }, async () => 'done')).toEqual(
			{
				ran: true,
				value: 'done',
			}
		)
	})

	it('does the work once when two runs start together, and gives the lease back after', async () => {
		const state = memoryStateStore({ now: () => new Date() })
		let finish: () => void = () => undefined
		const held = new Promise<void>((resolve) => {
			finish = resolve
		})
		const work = vi.fn(async () => {
			await held
			return 'counted'
		})
		const first = underLease(
			{ lease: leaseOn(state, 'a', 60_000), ttlMs: 60_000, warn: vi.fn() },
			work
		)
		const second = await underLease(
			{ lease: leaseOn(state, 'b', 60_000), ttlMs: 60_000, warn: vi.fn() },
			work
		)
		expect(second).toEqual({ ran: false })
		finish()
		expect(await first).toEqual({ ran: true, value: 'counted' })
		expect(work).toHaveBeenCalledTimes(1)
		expect(await state.held(leaseKey('analytics-sync'))).toBe(false)
	})

	it('renews the lease every third of its duration, so a long run keeps it', async () => {
		let now = Date.parse('2026-10-07T00:00:00.000Z')
		const state = memoryStateStore({ now: () => new Date(now) })
		const lease = leaseOn(state, 'a', 30_000)
		const claim = vi.spyOn(lease, 'claim')
		let lost: (() => boolean) | undefined
		let finish: () => void = () => undefined
		const held = new Promise<void>((resolve) => {
			finish = resolve
		})
		const run = underLease({ lease, ttlMs: 30_000, warn: vi.fn() }, async (hold) => {
			lost = hold.lost
			await held
		})
		await vi.advanceTimersByTimeAsync(0)
		for (let tick = 0; tick < 6; tick++) {
			now += 10_000
			await vi.advanceTimersByTimeAsync(10_000)
		}
		expect(claim.mock.calls.length).toBeGreaterThanOrEqual(7)
		expect(await state.claim(leaseKey('analytics-sync'), 'b', 30_000)).toBe(false)
		expect(lost?.()).toBe(false)
		finish()
		await run
	})

	it('tells the work it lost the lease once a renewal finds another holder', async () => {
		let now = Date.parse('2026-10-07T00:00:00.000Z')
		const state = memoryStateStore({ now: () => new Date(now) })
		let lost: (() => boolean) | undefined
		let finish: () => void = () => undefined
		const held = new Promise<void>((resolve) => {
			finish = resolve
		})
		const run = underLease(
			{ lease: leaseOn(state, 'a', 30_000), ttlMs: 30_000, warn: vi.fn() },
			async (hold) => {
				lost = hold.lost
				await held
			}
		)
		await vi.advanceTimersByTimeAsync(0)
		// A frozen holder lets its lease lapse, and another run takes it before the next renewal.
		now += 31_000
		expect(await state.claim(leaseKey('analytics-sync'), 'b', 30_000)).toBe(true)
		await vi.advanceTimersByTimeAsync(10_000)
		expect(lost?.()).toBe(true)
		finish()
		await run
		expect(await state.held(leaseKey('analytics-sync'))).toBe(true)
	})
})
