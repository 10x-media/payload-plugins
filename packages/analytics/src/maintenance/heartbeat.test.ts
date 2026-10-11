import { describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../core/jobs'
import { memoryStateStore } from '../native/store/memory/memoryState'
import { createHeartbeatWatch, HEARTBEAT_CHECK_EVERY_MS } from './heartbeat'

const HOUR = 3_600_000
const START = Date.parse('2026-10-07T00:00:00.000Z')

const sixHourly: ScheduledTask = { queue: 'analytics', cron: '0 */6 * * *', intervalMs: 6 * HOUR }

const setup = (schedule: ScheduledTask = sixHourly) => {
	let now = START
	const state = memoryStateStore({ now: () => new Date(now) })
	const warn = vi.fn()
	const watch = createHeartbeatWatch({
		task: 'analytics-sync',
		schedule,
		state: () => state,
		now: () => now,
		warn,
	})
	const at = async (ms: number) => {
		now = ms
		watch.maybeCheck()
		await watch.idle()
	}
	return { state, warn, at, watch }
}

describe('createHeartbeatWatch', () => {
	it('stays quiet while the task ran within two intervals', async () => {
		const { state, warn, at } = setup()
		await state.beat('analytics-sync')
		await at(START + 12 * HOUR)
		expect(warn).not.toHaveBeenCalled()
	})

	it('warns once when the last run is more than two intervals old, naming the queue', async () => {
		const { state, warn, at } = setup()
		await state.beat('analytics-sync')
		await at(START + 13 * HOUR)
		await at(START + 14 * HOUR)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(
			/analytics-sync last finished 13 hours ago, though it is scheduled every 6 hours\. Check that a job runner works the "analytics" queue/
		)
	})

	it('waits two intervals after this instance started before saying a task never ran', async () => {
		const { warn, at } = setup()
		await at(START + 11 * HOUR)
		expect(warn).not.toHaveBeenCalled()
		await at(START + 13 * HOUR)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(
			/has not finished since this server started 13 hours ago/
		)
	})

	it('warns again after a run was seen, once the task stalls anew', async () => {
		const { state, warn, at } = setup()
		await at(START + 13 * HOUR)
		await state.beat('analytics-sync')
		await at(START + 14 * HOUR)
		await at(START + 27 * HOUR)
		expect(warn).toHaveBeenCalledTimes(2)
	})

	it('reads the heartbeat at most once per check interval', async () => {
		const { state, at } = setup()
		const lastBeat = vi.spyOn(state, 'lastBeat')
		await at(START + 1)
		await at(START + 2)
		await at(START + HEARTBEAT_CHECK_EVERY_MS + 1)
		expect(lastBeat).toHaveBeenCalledTimes(2)
	})

	it('watches no task left unscheduled', async () => {
		const { state, warn, at } = setup({ ...sixHourly, cron: null })
		const lastBeat = vi.spyOn(state, 'lastBeat')
		await at(START + 100 * HOUR)
		expect(lastBeat).not.toHaveBeenCalled()
		expect(warn).not.toHaveBeenCalled()
	})
})
