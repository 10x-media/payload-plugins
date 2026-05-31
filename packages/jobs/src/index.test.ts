import { describe, expect, it } from 'vitest'

import { jobs } from './index'

describe('jobs factory', () => {
	it('returns a Payload plugin function when enabled', () => {
		expect(typeof jobs({})).toBe('function')
	})

	it('returns a Payload plugin function when disabled', () => {
		expect(typeof jobs({ disabled: true })).toBe('function')
	})
})
