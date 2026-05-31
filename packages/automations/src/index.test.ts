import { describe, expect, it } from 'vitest'

import { automations } from './index'

describe('automations factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof automations({})).toBe('function')
	})
})
