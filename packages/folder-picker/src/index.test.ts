import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { folderPicker } from './index'

const fakeConfig = { collections: [] } as unknown as Config

describe('folderPicker factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof folderPicker({})).toBe('function')
	})

	it('returns the incoming config untouched (passthrough scaffold)', () => {
		expect(folderPicker({})(fakeConfig)).toBe(fakeConfig)
	})
})
