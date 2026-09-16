import { describe, expect, it } from 'vitest'
import { extractUtm, MAX_UTM_LENGTH } from './utm'

describe('extractUtm', () => {
	it('extracts the five utm keys', () => {
		expect(
			extractUtm(
				'utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_content=hero&utm_term=shoes'
			)
		).toEqual({
			utmSource: 'newsletter',
			utmMedium: 'email',
			utmCampaign: 'spring',
			utmContent: 'hero',
			utmTerm: 'shoes',
		})
	})

	it('decodes percent-encoded values and plus-encoded spaces', () => {
		expect(extractUtm('utm_campaign=spring%20sale&utm_term=running+shoes')).toEqual({
			utmCampaign: 'spring sale',
			utmTerm: 'running shoes',
		})
	})

	it('reads the keys case-insensitively', () => {
		expect(extractUtm('UTM_Source=Newsletter&UTM_MEDIUM=email')).toEqual({
			utmSource: 'Newsletter',
			utmMedium: 'email',
		})
	})

	it('keeps the value case, trimming surrounding whitespace', () => {
		expect(extractUtm('utm_source=%20Newsletter%20')).toEqual({ utmSource: 'Newsletter' })
	})

	it('caps a long value', () => {
		const value = 'a'.repeat(MAX_UTM_LENGTH + 50)
		expect(extractUtm(`utm_campaign=${value}`).utmCampaign).toHaveLength(MAX_UTM_LENGTH)
	})

	it('drops an empty or whitespace-only value', () => {
		expect(extractUtm('utm_source=&utm_medium=%20%20&utm_campaign=x')).toEqual({
			utmCampaign: 'x',
		})
	})

	it('ignores every non-utm key', () => {
		expect(extractUtm('page=2&q=shoes&gclid=abc&utm_source=google')).toEqual({
			utmSource: 'google',
		})
	})

	it('keeps the first value when a key repeats', () => {
		expect(extractUtm('utm_source=first&utm_source=second')).toEqual({ utmSource: 'first' })
	})

	it('tolerates a leading question mark', () => {
		expect(extractUtm('?utm_source=google')).toEqual({ utmSource: 'google' })
	})

	it('returns nothing for a missing or empty query', () => {
		expect(extractUtm(undefined)).toEqual({})
		expect(extractUtm('')).toEqual({})
		expect(extractUtm('not-a-pair')).toEqual({})
	})
})
