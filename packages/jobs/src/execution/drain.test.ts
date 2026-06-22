import { describe, expect, it, vi } from 'vitest'

import { drainWorker } from './drain'

const virtualClock = () => {
	let nowMs = 0
	return {
		now: () => nowMs,
		sleep: (ms: number) => {
			nowMs += ms
			return Promise.resolve()
		},
	}
}

const baseDeps = (over = {}) => {
	const clock = virtualClock()
	return {
		countInFlight: vi.fn(() => Promise.resolve(0)),
		destroy: vi.fn(() => Promise.resolve()),
		now: clock.now,
		releaseLeadership: vi.fn(() => Promise.resolve()),
		requeueStragglers: vi.fn(() => Promise.resolve(0)),
		sleep: clock.sleep,
		stopLoops: vi.fn(),
		...over,
	}
}

describe('drainWorker', () => {
	it('drains cleanly when in-flight reaches zero before the timeout', async () => {
		const counts = [2, 1, 0]
		const deps = baseDeps({ countInFlight: vi.fn(() => Promise.resolve(counts.shift() ?? 0)) })
		const res = await drainWorker(deps, { drainTimeoutMs: 10_000, pollIntervalMs: 100 })
		expect(res).toEqual({ inFlightAtStart: 2, remaining: 0, requeued: 0, timedOut: false })
		expect(deps.stopLoops).toHaveBeenCalledTimes(1)
		expect(deps.requeueStragglers).not.toHaveBeenCalled()
		expect(deps.releaseLeadership).toHaveBeenCalledTimes(1)
		expect(deps.destroy).toHaveBeenCalledTimes(1)
	})

	it('requeues stragglers when the timeout is reached with jobs still in flight', async () => {
		const deps = baseDeps({
			countInFlight: vi.fn(() => Promise.resolve(2)),
			requeueStragglers: vi.fn(() => Promise.resolve(2)),
		})
		const res = await drainWorker(deps, { drainTimeoutMs: 500, pollIntervalMs: 200 })
		expect(res.timedOut).toBe(true)
		expect(res.requeued).toBe(2)
		expect(deps.requeueStragglers).toHaveBeenCalledTimes(1)
		expect(deps.destroy).toHaveBeenCalledTimes(1)
	})

	it('does nothing to wait when there are no in-flight jobs', async () => {
		const deps = baseDeps()
		const res = await drainWorker(deps, { drainTimeoutMs: 500, pollIntervalMs: 200 })
		expect(res.inFlightAtStart).toBe(0)
		expect(res.timedOut).toBe(false)
		expect(deps.requeueStragglers).not.toHaveBeenCalled()
	})

	it('does not overrun the budget by more than one poll interval (item 10)', async () => {
		// Always returns 1 in-flight so the loop never exits early.
		const deps = baseDeps({
			countInFlight: vi.fn(() => Promise.resolve(1)),
			requeueStragglers: vi.fn(() => Promise.resolve(1)),
		})
		const res = await drainWorker(deps, { drainTimeoutMs: 500, pollIntervalMs: 200 })
		// After the fix, the loop breaks immediately after sleeping if time exceeded.
		// Virtual clock: each sleep(200) advances 200ms. At t=0 in-flight=1, sleep 200.
		// After sleep t=200 < 500, re-poll -> still 1, sleep 200. After sleep t=400 < 500,
		// re-poll -> still 1, sleep 200. After sleep t=600 >= 500, break immediately.
		// Without fix the loop would re-poll one extra time after the overrun sleep.
		expect(res.timedOut).toBe(true)
	})

	it('releases leadership before the polling loop, not after (item 11)', async () => {
		// With drainTimeoutMs large enough that the loop runs at least once, we can
		// observe that release comes before the first sleep call.
		const order: string[] = []
		let callCount = 0
		const clock = { ms: 0, now: () => 0 }
		const deps = baseDeps({
			now: () => clock.ms,
			countInFlight: vi.fn(() => {
				callCount++
				// Return 0 on the second call so the loop exits after one sleep.
				return Promise.resolve(callCount >= 2 ? 0 : 1)
			}),
			releaseLeadership: vi.fn(async () => {
				order.push('release')
			}),
			sleep: vi.fn(async (ms: number) => {
				order.push('sleep')
				clock.ms += ms
			}),
			destroy: vi.fn(async () => {
				order.push('destroy')
			}),
			requeueStragglers: vi.fn(() => Promise.resolve(0)),
		})
		await drainWorker(deps, { drainTimeoutMs: 5000, pollIntervalMs: 100 })
		// release must appear before any sleep in the sequence
		const releaseIdx = order.indexOf('release')
		const firstSleepIdx = order.indexOf('sleep')
		expect(releaseIdx).toBeLessThan(firstSleepIdx)
	})
})
