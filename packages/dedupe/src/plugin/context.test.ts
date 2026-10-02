import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import type { MatchFieldConfig } from '../options'
import { getCollectionContext, hashMatch } from './context'

const base: MatchFieldConfig[] = [
	{ path: 'email', weight: 45 },
	{ path: 'name', weight: 40, compare: 'text' },
]

describe('hashMatch', () => {
	it('changes when a preset changes, so keys computed by the old one go stale', () => {
		const exact = hashMatch([
			{ path: 'email', weight: 45 },
			{ path: 'name', weight: 40, compare: 'exact' },
		])
		expect(exact).not.toBe(hashMatch(base))
	})

	it('stays the same when only a weight or a penalty changes: keys do not depend on them', () => {
		expect(
			hashMatch([
				{ ...base[0], weight: 10, onDiffer: 'veto' } as MatchFieldConfig,
				base[1] as MatchFieldConfig,
			])
		).toBe(hashMatch(base))
	})

	it('tells two custom key functions apart', () => {
		const one = hashMatch([
			{ path: 'x', weight: 1, compare: { keys: (v) => [String(v)], similarity: () => 1 } },
		])
		const two = hashMatch([
			{
				path: 'x',
				weight: 1,
				compare: { keys: (v) => [String(v).toLowerCase()], similarity: () => 1 },
			},
		])
		expect(one).not.toBe(two)
	})

	it('is stable for the same config', () => {
		expect(hashMatch(base)).toBe(hashMatch([...base]))
	})
})

describe('getCollectionContext', () => {
	it('refuses an unconfigured collection as a bad request, not a crash', () => {
		// Only what getCollectionContext reads: the same shape buildContext writes.
		const payload = {
			[Symbol.for('@10x-media/dedupe/context')]: { collections: new Map([['customers', {}]]) },
		} as unknown as Payload
		expect(() => getCollectionContext(payload, 'ghosts')).toThrow(
			expect.objectContaining({ status: 400 })
		)
	})
})
