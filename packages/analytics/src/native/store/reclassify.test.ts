import { describe, expect, it } from 'vitest'
import { channelGroups, channelTupleOf, tupleKey, windowSlices } from './reclassify'
import type { ChannelTuple } from './types'

const tuple = (over: Partial<ChannelTuple>): ChannelTuple => ({
	ref: null,
	utmSource: null,
	utmMedium: null,
	clickId: null,
	...over,
})

describe('channelTupleOf', () => {
	it('reads an absent or null field as null and keeps any text as stored, an empty one included', () => {
		expect(channelTupleOf({ ref: 'google.com', utmMedium: null, clickId: '' })).toEqual(
			tuple({ ref: 'google.com', clickId: '' })
		)
		expect(channelTupleOf(undefined)).toEqual(tuple({}))
		expect(channelTupleOf({ ref: 7 })).toEqual(tuple({}))
	})
})

describe('channelGroups', () => {
	it('groups the distinct tuples by the channel each classifies into, in the order first met', () => {
		const classify = (each: ChannelTuple) =>
			each.ref ? 'organic-search' : each.utmMedium === 'email' ? 'email' : 'direct'
		const groups = channelGroups(
			[
				tuple({ ref: 'google.com' }),
				tuple({ utmSource: 'news', utmMedium: 'email' }),
				tuple({ ref: 'bing.com' }),
				tuple({ ref: 'google.com' }),
				tuple({}),
			],
			classify
		)
		expect([...groups]).toEqual([
			['organic-search', [tuple({ ref: 'google.com' }), tuple({ ref: 'bing.com' })]],
			['email', [tuple({ utmSource: 'news', utmMedium: 'email' })]],
			['direct', [tuple({})]],
		])
	})

	it('keeps a null apart from an empty string, since each matches only its own rows', () => {
		expect(tupleKey(tuple({ ref: '' }))).not.toBe(tupleKey(tuple({})))
		expect(
			channelGroups([tuple({ ref: '' }), tuple({})], () => 'direct').get('direct')
		).toHaveLength(2)
	})
})

describe('windowSlices', () => {
	it('cuts a window into days, the last one short', () => {
		const start = new Date('2026-10-05T06:00:00.000Z')
		const end = new Date('2026-10-07T00:00:00.000Z')
		expect(windowSlices(start, end).map((slice) => slice.start.toISOString())).toEqual([
			'2026-10-05T06:00:00.000Z',
			'2026-10-06T06:00:00.000Z',
		])
		expect(windowSlices(start, end).at(-1)?.end).toEqual(end)
		expect(windowSlices(end, start)).toEqual([])
	})
})
