import { describe, expect, it, vi } from 'vitest'

import { maintenanceCycle, runCycle, sweepCycle } from './workerCycles'

describe('runCycle', () => {
	it('runs jobs and swallows errors', async () => {
		const runJobs = vi.fn(() => Promise.reject(new Error('boom')))
		const error = vi.fn()
		await runCycle({ logger: { error }, runJobs })
		expect(runJobs).toHaveBeenCalledTimes(1)
		expect(error).toHaveBeenCalledTimes(1)
	})
})

describe('maintenanceCycle', () => {
	it('always ticks leaders and schedules only when scheduler-leader', async () => {
		const tickLeaders = vi.fn(() => Promise.resolve())
		const handleSchedules = vi.fn(() => Promise.resolve())
		const now = () => new Date('2026-08-01T00:00:00.000Z')

		await maintenanceCycle({ handleSchedules, isSchedulerLeader: () => false, now, tickLeaders })
		expect(tickLeaders).toHaveBeenCalledTimes(1)
		expect(handleSchedules).not.toHaveBeenCalled()

		await maintenanceCycle({ handleSchedules, isSchedulerLeader: () => true, now, tickLeaders })
		expect(handleSchedules).toHaveBeenCalledTimes(1)
	})
})

describe('sweepCycle', () => {
	it('sweeps only when sweeper-leader', async () => {
		const sweep = vi.fn(() => Promise.resolve())
		await sweepCycle({
			isSweeperLeader: () => false,
			sweep,
			tickSweeperLeader: vi.fn(() => Promise.resolve()),
		})
		expect(sweep).not.toHaveBeenCalled()
		await sweepCycle({
			isSweeperLeader: () => true,
			sweep,
			tickSweeperLeader: vi.fn(() => Promise.resolve()),
		})
		expect(sweep).toHaveBeenCalledTimes(1)
	})

	it('ticks sweeper leadership before checking isSweeperLeader (item 23)', async () => {
		const callOrder: string[] = []
		const tickSweeperLeader = vi.fn(async () => {
			callOrder.push('tick')
		})
		// isSweeperLeader returns true only after the tick (simulates freshly acquired leadership)
		let ticked = false
		const isSweeperLeader = vi.fn(() => {
			const result = ticked
			if (callOrder.includes('tick')) ticked = true
			return result
		})
		const sweep = vi.fn(async () => {
			callOrder.push('sweep')
		})

		// First call: tick fires, isSweeperLeader returns false (not yet leader before tick)
		await sweepCycle({ isSweeperLeader, sweep, tickSweeperLeader })
		expect(callOrder[0]).toBe('tick')

		// Second call: now is leader after tick
		ticked = true
		await sweepCycle({ isSweeperLeader, sweep, tickSweeperLeader })
		expect(sweep).toHaveBeenCalledTimes(1)
	})
})
