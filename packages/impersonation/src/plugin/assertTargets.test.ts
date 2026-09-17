import { describe, expect, it } from 'vitest'

import { missingHookedAuthSlugs } from './assertTargets'

describe('missingHookedAuthSlugs', () => {
	it('flags a live auth collection the plugin never saw', () => {
		expect(missingHookedAuthSlugs(['users', 'staff'], ['users'], undefined)).toEqual(['staff'])
	})

	it('ignores a late collection that is not in an explicit targets list', () => {
		expect(missingHookedAuthSlugs(['users', 'staff'], ['users'], ['users'])).toEqual([])
	})

	it('flags an explicit target that was not hooked', () => {
		expect(missingHookedAuthSlugs(['users', 'partners'], ['users'], ['partners'])).toEqual([
			'partners',
		])
	})
})
