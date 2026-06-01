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
})
