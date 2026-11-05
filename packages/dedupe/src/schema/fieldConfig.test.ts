import { describe, expect, it } from 'vitest'

import { dedupeCustom, readFieldConfig } from './fieldConfig'

describe('readFieldConfig', () => {
	it('reads a list drawn natively on the merge screen', () => {
		const admin = { custom: dedupeCustom({ split: true, mergeView: 'native' }) }
		expect(readFieldConfig({ name: 'phones', admin })).toEqual({
			split: true,
			mergeView: 'native',
		})
	})

	it('stops the app at boot on a merge view it does not know', () => {
		const admin = { custom: { dedupe: { mergeView: 'custom' } } }
		expect(() => readFieldConfig({ name: 'phones', admin })).toThrow(/"phones".*mergeView/)
	})
})
