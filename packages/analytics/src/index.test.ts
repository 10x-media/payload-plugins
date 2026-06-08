import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { analytics } from './index'

const fakeConfig = { collections: [] } as unknown as Config

describe('analytics factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof analytics({})).toBe('function')
	})

	it('returns the incoming config untouched (passthrough scaffold)', () => {
		expect(analytics({})(fakeConfig)).toBe(fakeConfig)
	})
})
