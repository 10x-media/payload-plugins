import { describe, expect, it } from 'vitest'
import { createInFlightCounter } from './inFlight'

describe('createInFlightCounter', () => {
	it('starts at zero', () => {
		const c = createInFlightCounter()
		expect(c.count()).toBe(0)
		expect(c.ids()).toEqual([])
	})

	it('counts running jobs and lists their ids', () => {
		const c = createInFlightCounter()
		c.increment('a')
		c.increment(2)
		expect(c.count()).toBe(2)
		expect(c.ids()).toEqual(['a', 2])
		c.decrement('a')
		expect(c.count()).toBe(1)
		expect(c.ids()).toEqual([2])
		c.decrement(2)
		expect(c.count()).toBe(0)
		expect(c.ids()).toEqual([])
	})
})
