import { describe, expect, it } from 'vitest'
import { DURATION_CASES, expectNoDurationFormat } from '../testing/durationCases'
import { formatDuration } from './format'

describe('formatDuration in the browser environment', () => {
	it.each(DURATION_CASES)('writes $ms ms in $locale as the server does', ({ ms, locale, text }) => {
		expect(formatDuration(ms, locale)).toBe(text)
	})

	it('never consults Intl.DurationFormat', () => {
		expectNoDurationFormat(['it', 'nl', 'pl', 'ja'])
	})
})
