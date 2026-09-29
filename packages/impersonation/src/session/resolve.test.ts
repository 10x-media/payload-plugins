import { describe, expect, it } from 'vitest'

import { openBySid } from './resolve'

describe('openBySid', () => {
	it('matches targetSid or impersonatorSid in one where', () => {
		expect(openBySid('abc')).toEqual({
			and: [
				{ endedAt: { exists: false } },
				{ or: [{ targetSid: { equals: 'abc' } }, { impersonatorSid: { equals: 'abc' } }] },
			],
		})
	})
})
