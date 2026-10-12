import { describe, expect, it } from 'vitest'
import { throttled } from './throttle'

describe('throttled', () => {
	it('says the first message, then nothing until the interval has passed', () => {
		let now = 0
		const said: string[] = []
		const say = throttled((message) => said.push(message), { now: () => now, intervalMs: 1000 })
		say('first')
		now = 999
		say('held')
		now = 1000
		say('second')
		expect(said).toEqual(['first', 'second'])
	})
})
