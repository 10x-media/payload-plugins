import type { CollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	assertJobsFit,
	assertMaintainRegistered,
	DEFAULT_JOBS,
	MAINTAIN_INTERVAL_MS,
	resolveJobs,
	SYNC_INTERVAL_MS,
	TASK_SLUGS,
	WARM_INTERVAL_MS,
} from './jobs'

const HOUR = 3_600_000

describe('resolveJobs', () => {
	it('schedules every task on the default queue at its own cadence unless told otherwise', () => {
		expect(resolveJobs(undefined)).toEqual(DEFAULT_JOBS)
		expect(DEFAULT_JOBS).toEqual({
			maintain: { queue: 'default', cron: '*/15 * * * *', intervalMs: MAINTAIN_INTERVAL_MS },
			sync: { queue: 'default', cron: '0 */6 * * *', intervalMs: SYNC_INTERVAL_MS },
			warm: { queue: 'default', cron: '*/30 * * * *', intervalMs: WARM_INTERVAL_MS },
			configured: new Set(),
		})
		expect(resolveJobs({})).toEqual(DEFAULT_JOBS)
	})

	it('names each task after its slug', () => {
		expect(TASK_SLUGS).toEqual({
			maintain: 'analytics-maintain',
			sync: 'analytics-sync',
			warm: 'analytics-warm',
		})
	})

	it('registers no task at all with false', () => {
		expect(resolveJobs(false)).toBe(false)
	})

	it('puts every task on jobs.queue, a task’s own queue and cron winning', () => {
		const jobs = resolveJobs({
			queue: 'analytics',
			tasks: {
				maintain: { queue: 'upkeep', cron: '0 * * * *' },
				sync: { cron: '0 3 * * *' },
				warm: { queue: 'warm' },
			},
		})
		expect(jobs).toEqual({
			maintain: { queue: 'upkeep', cron: '0 * * * *', intervalMs: HOUR },
			sync: { queue: 'analytics', cron: '0 3 * * *', intervalMs: 24 * HOUR },
			warm: { queue: 'warm', cron: '*/30 * * * *', intervalMs: WARM_INTERVAL_MS },
			configured: new Set(['maintain', 'sync', 'warm']),
		})
	})

	it('registers a task unscheduled with cron: false, judged at its default cadence', () => {
		expect(resolveJobs({ tasks: { maintain: { cron: false }, sync: { cron: false } } })).toEqual({
			...DEFAULT_JOBS,
			maintain: { queue: 'default', cron: null, intervalMs: MAINTAIN_INTERVAL_MS },
			sync: { queue: 'default', cron: null, intervalMs: SYNC_INTERVAL_MS },
			configured: new Set(['maintain', 'sync']),
		})
	})

	it('falls back to the default cadence for a pattern whose runs are not evenly apart', () => {
		expect(resolveJobs({ tasks: { maintain: { cron: '0,20 * * * *' } } })).toMatchObject({
			maintain: { cron: '0,20 * * * *', intervalMs: MAINTAIN_INTERVAL_MS },
		})
	})

	it('takes the analytics-state collection of an install without native() under jobs.state', () => {
		const overrides = (collection: CollectionConfig) => collection
		expect(resolveJobs({ state: { slug: ' task-state ', overrides } })).toMatchObject({
			state: { slug: 'task-state', overrides },
		})
		expect(resolveJobs({ state: {} })).toMatchObject({ state: { slug: 'analytics-state' } })
		expect(resolveJobs({ queue: 'analytics' })).not.toHaveProperty('state')
	})

	it('fails the boot on anything else', () => {
		const refused: Array<[unknown, RegExp]> = [
			[true, /jobs must be false, to register no task, or an object/],
			[[], /jobs must be false/],
			[{ queue: '' }, /jobs\.queue must be a queue name/],
			[{ cron: '* * * * *' }, /jobs\.cron is not an option; jobs takes queue, tasks and state/],
			[{ tasks: [] }, /jobs\.tasks must be an object/],
			[
				{ tasks: { prune: {} } },
				/jobs\.tasks\.prune is not a task; the tasks are maintain, sync, warm/,
			],
			[{ tasks: { maintain: 'often' } }, /jobs\.tasks\.maintain must be an object/],
			[{ tasks: { maintain: { cron: '' } } }, /jobs\.tasks\.maintain\.cron must be a cron pattern/],
			[{ tasks: { maintain: { cron: true } } }, /jobs\.tasks\.maintain\.cron/],
			[{ tasks: { maintain: { queue: 7 } } }, /jobs\.tasks\.maintain\.queue must be a queue name/],
			[{ tasks: { maintain: { every: 5 } } }, /jobs\.tasks\.maintain\.every is not an option/],
			[{ tasks: { sync: { cron: 'hourly' } } }, /jobs\.tasks\.sync\.cron must be a cron pattern/],
			[{ tasks: { warm: { queue: ' ' } } }, /jobs\.tasks\.warm\.queue must be a queue name/],
			[
				{ state: 'task-state' },
				/jobs\.state must be an object such as \{ slug: 'analytics-state' \}/,
			],
			[{ state: { slug: '' } }, /jobs\.state\.slug must be a non-empty collection slug/],
			[{ state: { overrides: {} } }, /jobs\.state\.overrides must be a function/],
			[
				{ state: { hidden: true } },
				/jobs\.state\.hidden is not an option; jobs\.state takes slug and overrides/,
			],
		]
		for (const [option, message] of refused) {
			expect(() => resolveJobs(option), JSON.stringify(option)).toThrow(message)
		}
	})
})

describe('assertJobsFit', () => {
	const off = { sync: false, warm: false }

	it('takes jobs: false on an install whose work has a fallback or no task', () => {
		expect(() => assertJobsFit(false, off)).not.toThrow()
	})

	it('refuses jobs: false beside sync or warming, saying how to keep the task unscheduled', () => {
		expect(() => assertJobsFit(false, { sync: true, warm: false })).toThrow(
			/jobs: false registers no task, but this install turns on sync, which only the analytics-sync task fills\. Turn it off, or replace jobs: false with entries such as jobs: \{ tasks: \{ sync: \{ cron: false \} \} \}/
		)
		expect(() => assertJobsFit(false, { sync: false, warm: true })).toThrow(
			/turns on cache\.warm, which only the analytics-warm task runs/
		)
	})

	it('refuses an entry for a task its feature does not register', () => {
		expect(() => assertJobsFit(resolveJobs({ tasks: { sync: {} } }), off)).toThrow(
			/jobs\.tasks\.sync schedules analytics-sync, which is registered only while sync is on/
		)
		expect(() => assertJobsFit(resolveJobs({ tasks: { warm: {} } }), off)).toThrow(
			/jobs\.tasks\.warm schedules analytics-warm/
		)
		expect(() =>
			assertJobsFit(resolveJobs({ tasks: { sync: {}, warm: {} } }), { sync: true, warm: true })
		).not.toThrow()
	})
})

describe('assertMaintainRegistered', () => {
	it('refuses a maintain entry on an install no native() registered the task for', () => {
		const configured = resolveJobs({ tasks: { maintain: { cron: '0 * * * *' } } })
		expect(() => assertMaintainRegistered(configured, false)).toThrow(
			/jobs\.tasks\.maintain schedules analytics-maintain, which only native\(\) registers/
		)
		expect(() => assertMaintainRegistered(configured, true)).not.toThrow()
		expect(() => assertMaintainRegistered(DEFAULT_JOBS, false)).not.toThrow()
		expect(() => assertMaintainRegistered(false, false)).not.toThrow()
	})
})
