import { describe, expect, it } from 'vitest'

import { loggedInAccess } from './access'
import { resolveQueueControlOptions } from './options'

describe('resolveQueueControlOptions', () => {
	it('returns null when disabled', () => {
		expect(resolveQueueControlOptions(undefined)).toBeNull()
		expect(resolveQueueControlOptions(false)).toBeNull()
	})

	it('defaults access to logged-in-only and queues to [default]', () => {
		expect(resolveQueueControlOptions({})).toEqual({ access: loggedInAccess, queues: ['default'] })
	})

	it('treats true as enabling with defaults (same as {})', () => {
		expect(resolveQueueControlOptions(true)).toEqual(resolveQueueControlOptions({}))
	})

	it('honors a custom access checker and queues', () => {
		const access = () => true
		expect(resolveQueueControlOptions({ access, queues: ['a', 'b'] })).toEqual({
			access,
			queues: ['a', 'b'],
		})
	})
})
