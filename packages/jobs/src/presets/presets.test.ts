import { describe, expect, it } from 'vitest'

import { multiNodePreset, serverlessPreset, singleNodePreset, vercelCrons } from './presets'

describe('presets', () => {
	it('singleNodePreset enables reliability and queue control with defaults', () => {
		expect(singleNodePreset()).toEqual({ queueControl: {}, reliability: {} })
	})

	it('multiNodePreset threads the leader id', () => {
		expect(multiNodePreset({ leaderId: 'node-7' })).toEqual({
			queueControl: {},
			reliability: { leaderId: 'node-7' },
		})
		expect(multiNodePreset()).toEqual({ queueControl: {}, reliability: {} })
	})

	it('serverlessPreset enables reliability and guards with the cron secret', () => {
		const preset = serverlessPreset()
		expect(preset.reliability).toEqual({})
		expect(typeof preset.queueControl.access).toBe('function')
	})

	it('vercelCrons builds the run cron entry', () => {
		expect(vercelCrons()).toEqual([
			{ path: '/api/payload-jobs/queue-run?allQueues=true', schedule: '* * * * *' },
		])
		expect(vercelCrons({ runSchedule: '*/5 * * * *' })[0]?.schedule).toBe('*/5 * * * *')
	})
})
