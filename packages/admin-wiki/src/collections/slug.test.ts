import { describe, expect, it } from 'vitest'

import { slugify } from './slug'

describe('slugify', () => {
	it('kebab-cases and strips diacritics', () => {
		expect(slugify('Héllo Wörld! Publishing 101')).toBe('hello-world-publishing-101')
	})

	it('collapses separators and trims dashes', () => {
		expect(slugify('  How -- to / publish  ')).toBe('how-to-publish')
	})
})
