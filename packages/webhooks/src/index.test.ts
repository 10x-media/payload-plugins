import { describe, expect, it } from 'vitest'

import { webhooks } from './index'

describe('webhooks factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof webhooks({})).toBe('function')
	})
})
