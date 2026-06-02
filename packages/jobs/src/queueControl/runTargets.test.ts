import { describe, expect, it } from 'vitest'

import { runTargetsForPause } from './runTargets'

describe('runTargetsForPause', () => {
	it('runs nothing when globally paused', () => {
		expect(runTargetsForPause(undefined, { global: true, queues: [] })).toEqual([])
		expect(runTargetsForPause(['a'], { global: true, queues: [] })).toEqual([])
	})

	it('drops paused queues from a specific queue list', () => {
		expect(runTargetsForPause(['a', 'b'], { global: false, queues: ['a'] })).toEqual([
			{ queue: 'b' },
		])
	})

	it('excludes paused queues via not_in when running all queues', () => {
		expect(runTargetsForPause(undefined, { global: false, queues: ['x'] })).toEqual([
			{ allQueues: true, where: { queue: { not_in: ['x'] } } },
		])
	})

	it('runs all queues plainly when nothing is paused', () => {
		expect(runTargetsForPause(undefined, { global: false, queues: [] })).toEqual([
			{ allQueues: true },
		])
	})
})
