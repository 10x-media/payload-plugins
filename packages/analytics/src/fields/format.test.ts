import { describe, expect, it } from 'vitest'
import { NO_VALUE } from '../core/metricValues'
import { DURATION_CASES, expectNoDurationFormat } from '../testing/durationCases'
import { formatCount, formatDuration, formatMetricValue, formatPercent, formatRate } from './format'

describe('formatDuration', () => {
	it.each(DURATION_CASES)('writes $ms ms in $locale as "$text"', ({ ms, locale, text }) => {
		expect(formatDuration(ms, locale)).toBe(text)
	})

	it('never consults Intl.DurationFormat, which Node 22 lacks and browsers have', () => {
		expectNoDurationFormat(['it', 'nl', 'pl', 'ja'])
	})

	// `zhTw` is how a host imports Payload's Traditional Chinese, and `Intl` refuses the code.
	it('reads a Payload language code Intl refuses in the language it names', () => {
		expect(formatDuration(83_000, 'zhTw')).toBe(formatDuration(83_000, 'zh-TW'))
		expect(formatDuration(83_000, 'not a tag')).toBe('1m 23s')
	})
})

// One conversion rate must read alike on the dashboard and in the view (4.8%, never 4.83%).
describe('formatRate', () => {
	it('writes every rate with one decimal place, wherever it is shown', () => {
		expect(formatRate(0.04833, 'en')).toBe('4.8%')
		expect(formatRate(0.1, 'en')).toBe('10%')
		expect(formatRate(1, 'en')).toBe('100%')
		expect(formatRate(0.04833, 'de')).toBe('4,8\u00a0%')
	})

	it('keeps a rate under one percent from rounding to nothing', () => {
		expect(formatRate(0.0004, 'en')).toBe('0.04%')
		expect(formatRate(0.0043, 'en')).toBe('0.43%')
		expect(formatRate(0, 'en')).toBe('0%')
	})

	it('writes a rate with a side missing as the no-value dash, never 0%', () => {
		expect(formatRate(null, 'en')).toBe(NO_VALUE)
		expect(formatRate(undefined, 'en')).toBe(NO_VALUE)
	})
})

describe('formatCount', () => {
	it('groups thousands for the en-US locale', () => {
		expect(formatCount(2, 'en-US')).toBe('2')
		expect(formatCount(1234, 'en-US')).toBe('1,234')
	})
})

describe('formatPercent', () => {
	it('writes a 0..100 rate as the locale writes a percentage', () => {
		expect(formatPercent(42, 'en-US')).toBe('42%')
		expect(formatPercent(42, 'de-DE')).toBe('42 %')
	})
})

describe('formatMetricValue', () => {
	it('formats avgDuration as a duration', () => {
		expect(formatMetricValue('avgDuration', 83_000, 'en-US')).toContain('1')
	})

	it('formats visitDuration as a duration too, and no data as a dash', () => {
		expect(formatMetricValue('visitDuration', 83_000, 'en-US')).toBe(
			formatDuration(83_000, 'en-US')
		)
		expect(formatMetricValue('visitDuration', null, 'en-US')).toBe('-')
	})

	it('formats count metrics with grouping', () => {
		expect(formatMetricValue('pageviews', 1234, 'en-US')).toBe('1,234')
		expect(formatMetricValue('visitors', 5, 'en-US')).toBe('5')
	})

	it('formats bounceRate as a percentage', () => {
		expect(formatMetricValue('bounceRate', 42, 'en-US')).toBe('42%')
	})

	it('formats scrollDepth as a percentage', () => {
		expect(formatMetricValue('scrollDepth', 65, 'en-US')).toBe('65%')
	})
})

describe('formatMetricValue with a reporting currency', () => {
	it('writes revenue as money only when a currency is resolved', () => {
		expect(formatMetricValue('revenue', 1234.5, 'en-US')).toBe('1,234.5')
		expect(formatMetricValue('revenue', 1234.5, { locale: 'en-US' })).toBe('1,234.5')
		expect(formatMetricValue('revenue', 1234.5, { locale: 'en-US', currency: 'EUR' })).toContain(
			'1,234.50'
		)
	})

	it('leaves every other metric alone', () => {
		expect(formatMetricValue('pageviews', 1200, { locale: 'en-US', currency: 'EUR' })).toBe('1,200')
		expect(formatMetricValue('bounceRate', 40, { locale: 'en-US', currency: 'EUR' })).toBe('40%')
	})

	it('falls back to a plain number for a code Intl refuses', () => {
		expect(formatMetricValue('revenue', 10, { locale: 'en-US', currency: 'NOPE' })).toBe('10')
	})
})

describe('formatMetricValue without a reading', () => {
	// "0s" and "0%" would read as a measured zero; no samples is no data.
	it('writes a dash for null and for a missing value, whatever the metric', () => {
		expect(formatMetricValue('avgDuration', null, 'en-US')).toBe('-')
		expect(formatMetricValue('scrollDepth', null, 'en-US')).toBe('-')
		expect(formatMetricValue('bounceRate', undefined, { locale: 'de-DE' })).toBe('-')
		expect(formatMetricValue('revenue', null, { locale: 'en-US', currency: 'EUR' })).toBe('-')
	})

	it('still writes a real zero as zero', () => {
		expect(formatMetricValue('pageviews', 0, 'en-US')).toBe('0')
		expect(formatMetricValue('scrollDepth', 0, 'en-US')).toBe('0%')
	})
})
