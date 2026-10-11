import { describe, expect, it } from 'vitest'

import { flattenEntries } from './flatten'

describe('flattenEntries', () => {
	it('dots through objects and arrays down to the leaves', () => {
		expect(
			flattenEntries({
				seo: { title: 'A' },
				sections: [{ heading: 'One' }],
				tags: ['x'],
				views: 3,
			})
		).toEqual([
			['seo.title', 'A'],
			['sections.0.heading', 'One'],
			['tags.0', 'x'],
			['views', 3],
		])
	})

	it('keeps empty containers and nulls as leaves', () => {
		expect(flattenEntries({ empty: {}, list: [], none: null })).toEqual([
			['empty', {}],
			['list', []],
			['none', null],
		])
	})

	it('gives nothing for an empty or scalar root', () => {
		expect(flattenEntries({})).toEqual([])
		expect(flattenEntries(undefined)).toEqual([])
	})
})
