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

	it('serverlessPreset derives staleness from maxDuration and guards with the cron secret', () => {
		const preset = serverlessPreset({ maxDurationMs: 800_000 })
		expect(preset.reliability.serverless).toEqual({ maxDurationMs: 800_000 })
		expect(preset.reliability.jobLeaseTtlMs).toBe(800_000)
		expect(typeof preset.queueControl.access).toBe('function')
	})

	it('vercelCrons builds run and sweep cron entries', () => {
		expect(vercelCrons()).toEqual([
			{ path: '/api/payload-jobs/queue-run?allQueues=true', schedule: '* * * * *' },
			{ path: '/api/payload-jobs/queue-sweep', schedule: '* * * * *' },
		])
		expect(vercelCrons({ sweepSchedule: '*/5 * * * *' })[1]?.schedule).toBe('*/5 * * * *')
	})
})
