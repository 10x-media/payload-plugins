import { describe, expect, it } from 'vitest'
import { applyPollOptions } from './applyPollOptions'

const fields = [
	{ blockType: 'text', name: 'nickname' },
	{
		blockType: 'select',
		name: 'winner',
		options: [{ label: 'Old', value: 'old' }],
	},
]

const resolved = [
	{ label: 'Ada', value: 'ada' },
	{ label: 'Grace', value: 'grace' },
]

describe('applyPollOptions', () => {
	it('replaces the matching instance options without mutating the input', () => {
		const out = applyPollOptions(fields, 'winner', resolved)
		expect(out[1]).toEqual({ blockType: 'select', name: 'winner', options: resolved })
		expect(out[0]).toBe(fields[0])
		expect(fields[1]?.options).toEqual([{ label: 'Old', value: 'old' }])
	})

	it('is a no-op when resultsField is unset or matches nothing', () => {
		expect(applyPollOptions(fields, undefined, resolved)).toBe(fields)
		expect(applyPollOptions(fields, null, resolved)).toBe(fields)
		expect(applyPollOptions(fields, '', resolved)).toBe(fields)
		const out = applyPollOptions(fields, 'missing', resolved)
		expect(out).toEqual(fields)
	})
})
