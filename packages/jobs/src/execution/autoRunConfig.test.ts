import { describe, expect, it } from 'vitest'

import { autoRunConfig } from './autoRunConfig'

describe('autoRunConfig', () => {
	it('defaults to one silent default-queue config every minute', () => {
		expect(autoRunConfig()).toEqual([
			{ cron: '* * * * *', disableScheduling: false, limit: 10, queue: 'default', silent: true },
		])
	})

	it('maps one config per queue, honoring per-queue cron and limit', () => {
		expect(
			autoRunConfig({
				queues: [{ queue: 'default' }, { cron: '*/5 * * * *', limit: 50, queue: 'emails' }],
			})
		).toEqual([
			{ cron: '* * * * *', disableScheduling: false, limit: 10, queue: 'default', silent: true },
			{ cron: '*/5 * * * *', disableScheduling: false, limit: 50, queue: 'emails', silent: true },
		])
	})

	it('honors silent and disableScheduling', () => {
		expect(autoRunConfig({ disableScheduling: true, silent: false })).toEqual([
			{ cron: '* * * * *', disableScheduling: true, limit: 10, queue: 'default', silent: false },
		])
	})
})
