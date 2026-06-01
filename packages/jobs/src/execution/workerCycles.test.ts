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
		await sweepCycle({ isSweeperLeader: () => false, sweep })
		expect(sweep).not.toHaveBeenCalled()
		await sweepCycle({ isSweeperLeader: () => true, sweep })
		expect(sweep).toHaveBeenCalledTimes(1)
	})
})
