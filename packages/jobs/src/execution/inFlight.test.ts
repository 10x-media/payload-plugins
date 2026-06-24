import { describe, expect, it } from 'vitest'
import { createInFlightCounter } from './inFlight'

describe('createInFlightCounter', () => {
	it('starts at zero', () => {
		expect(createInFlightCounter().count()).toBe(0)
	})

	it('increments and decrements correctly', () => {
		const c = createInFlightCounter()
		c.increment()
		c.increment()
		expect(c.count()).toBe(2)
		c.decrement()
		expect(c.count()).toBe(1)
		c.decrement()
		expect(c.count()).toBe(0)
	})
})
