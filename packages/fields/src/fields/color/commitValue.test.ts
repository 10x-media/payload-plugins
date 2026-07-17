import { describe, expect, it } from 'vitest'
import { resolveCommitValue } from './commitValue'

describe('resolveCommitValue', () => {
	it('clearable empty commit clears the value', () => {
		expect(
			resolveCommitValue({ draft: '', isClearable: true, lastValid: '#ff0000', parsed: null })
		).toEqual({ lastValid: '#ff0000', reverted: false, value: null })
	})

	it('non-clearable empty commit reverts to the last valid value', () => {
		expect(
			resolveCommitValue({ draft: '  ', isClearable: false, lastValid: '#ff0000', parsed: null })
		).toEqual({ lastValid: '#ff0000', reverted: true, value: '#ff0000' })
	})

	it('non-clearable empty commit without a prior value stays empty', () => {
		expect(
			resolveCommitValue({ draft: '', isClearable: false, lastValid: null, parsed: null })
		).toEqual({ lastValid: null, reverted: false, value: null })
	})

	it('non-clearable unparseable commit reverts to the last valid value', () => {
		expect(
			resolveCommitValue({ draft: 'zzz', isClearable: false, lastValid: '#ff0000', parsed: null })
		).toEqual({ lastValid: '#ff0000', reverted: true, value: '#ff0000' })
	})

	it('valid commit stores the normalized value and becomes the new revert target', () => {
		expect(
			resolveCommitValue({
				draft: 'red',
				isClearable: false,
				lastValid: '#00ff00',
				parsed: '#ff0000',
			})
		).toEqual({ lastValid: '#ff0000', reverted: false, value: '#ff0000' })
	})

	it('unparseable commit without a revert target stores the raw draft so validation surfaces it', () => {
		expect(
			resolveCommitValue({ draft: 'zzz', isClearable: true, lastValid: null, parsed: null })
		).toEqual({ lastValid: null, reverted: false, value: 'zzz' })
		expect(
			resolveCommitValue({ draft: 'zzz', isClearable: false, lastValid: null, parsed: null })
		).toEqual({ lastValid: null, reverted: false, value: 'zzz' })
	})
})
