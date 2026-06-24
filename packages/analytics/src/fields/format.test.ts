import { describe, expect, it } from 'vitest'
import { formatCount, formatDuration, formatMetricValue } from './format'

describe('formatDuration', () => {
	it('formats sub-minute durations as seconds', () => {
		expect(formatDuration(0)).toBe('0s')
		expect(formatDuration(45_000)).toBe('45s')
	})

	it('formats minutes and seconds', () => {
		expect(formatDuration(83_000)).toBe('1m 23s')
		expect(formatDuration(120_000)).toBe('2m')
	})

	it('formats hours and minutes', () => {
		expect(formatDuration(3_660_000)).toBe('1h 1m')
	})
})

describe('formatCount', () => {
	it('groups thousands for the en-US locale', () => {
		expect(formatCount(2, 'en-US')).toBe('2')
		expect(formatCount(1234, 'en-US')).toBe('1,234')
	})
})

describe('formatMetricValue', () => {
	it('formats avgDuration as a duration', () => {
		expect(formatMetricValue('avgDuration', 83_000, 'en-US')).toBe('1m 23s')
	})

	it('formats count metrics with grouping', () => {
		expect(formatMetricValue('pageviews', 1234, 'en-US')).toBe('1,234')
		expect(formatMetricValue('visitors', 5, 'en-US')).toBe('5')
	})

	it('formats bounceRate as a percentage', () => {
		expect(formatMetricValue('bounceRate', 42, 'en-US')).toBe('42%')
	})
})
