import { describe, expect, it } from 'vitest'

import { buildJobsLocksCollection } from './locksCollection'

describe('buildJobsLocksCollection', () => {
	it('exempts the lease rows from content locks', () => {
		expect(buildJobsLocksCollection().custom).toEqual({ contentLock: { exempt: true } })
	})
})
