import { describe, expect, it } from 'vitest'
import { withoutVisitsAlias } from './metricAliases'

describe('withoutVisitsAlias', () => {
	it('keeps sessions where a list holds both names of the one count', () => {
		expect(withoutVisitsAlias(['pageviews', 'visits', 'sessions'])).toEqual([
			'pageviews',
			'sessions',
		])
	})

	it('keeps visits where it is the only name a source serves', () => {
		expect(withoutVisitsAlias(['pageviews', 'visits'])).toEqual(['pageviews', 'visits'])
		expect(withoutVisitsAlias(['pageviews', 'sessions'])).toEqual(['pageviews', 'sessions'])
	})
})
