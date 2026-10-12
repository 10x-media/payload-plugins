import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from '../options'
import { CHECK_TASK_SLUG, registerJobs, SCAN_TASK_SLUG } from './registerJobs'

const match = { fields: [{ path: 'email', weight: 1 }] }
const tasksOf = (config: Config) => (config.jobs?.tasks ?? []).map((task) => task.slug)

describe('registerJobs', () => {
	it('registers the check and the scan for a worker to run', () => {
		const config = {} as Config
		registerJobs(config, resolveOptions({ collections: { customers: { match } } }))
		expect(tasksOf(config)).toEqual([CHECK_TASK_SLUG, SCAN_TASK_SLUG])
	})

	it('sets no concurrency key unless the host turns concurrency control on, which Payload requires', () => {
		const plain = {} as Config
		registerJobs(plain, resolveOptions({ collections: { customers: { match } } }))
		expect(plain.jobs?.tasks?.every((task) => task.concurrency === undefined)).toBe(true)

		const controlled = { jobs: { enableConcurrencyControl: true } } as Config
		registerJobs(controlled, resolveOptions({ collections: { customers: { match } } }))
		expect(controlled.jobs?.tasks?.every((task) => task.concurrency !== undefined)).toBe(true)
	})

	it('leaves the jobs queue alone when the scan runs in the request and nothing is scheduled', () => {
		const config = {} as Config
		registerJobs(
			config,
			resolveOptions({ collections: { customers: { match } }, disableJobsQueue: true })
		)
		expect(config.jobs).toBeUndefined()
	})

	it('still registers it for a schedule, which only a worker runs', () => {
		const config = {} as Config
		registerJobs(
			config,
			resolveOptions({
				collections: { customers: { match } },
				disableJobsQueue: true,
				scan: { cron: '0 3 * * *' },
			})
		)
		expect(tasksOf(config)).toEqual([SCAN_TASK_SLUG])
	})
})
