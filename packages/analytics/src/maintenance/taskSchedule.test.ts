import { describe, expect, it } from 'vitest'
import { concurrencyFor, scheduleFor } from './taskSchedule'

describe('scheduleFor', () => {
	it('schedules a task on its queue under Payload’s own rule, and leaves an unscheduled one bare', () => {
		expect(scheduleFor({ queue: 'analytics', cron: '0 * * * *', intervalMs: 3_600_000 })).toEqual({
			schedule: [{ cron: '0 * * * *', queue: 'analytics' }],
		})
		expect(scheduleFor({ queue: 'analytics', cron: null, intervalMs: 1 })).toEqual({})
	})
})

describe('concurrencyFor', () => {
	it('keys a task as analytics:<task>, exclusive and never deleting older runs', () => {
		const { concurrency } = concurrencyFor('warm')
		if (typeof concurrency !== 'object') {
			throw new Error('expected the object form')
		}
		expect(concurrency.key({ input: {}, queue: 'default' })).toBe('analytics:warm')
		expect(concurrency).toMatchObject({ exclusive: true, supersedes: false })
		const keyed = concurrencyFor('maintain', () => 'analytics:maintain:rebuild:a:b:c')
		if (typeof keyed.concurrency !== 'object') {
			throw new Error('expected the object form')
		}
		expect(keyed.concurrency.key({ input: {}, queue: 'q' })).toBe(
			'analytics:maintain:rebuild:a:b:c'
		)
	})
})
