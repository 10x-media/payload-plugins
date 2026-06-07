import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { formBuilder } from './index'

const fakeConfig = { collections: [] } as unknown as Config

describe('formBuilder factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof formBuilder({})).toBe('function')
	})

	it('returns the incoming config untouched (passthrough scaffold)', () => {
		expect(formBuilder({})(fakeConfig)).toBe(fakeConfig)
	})
})
