import { describe, expect, it } from 'vitest'

import { formatRelativeTime } from './formatRelativeTime'

const NOW = Date.parse('2026-05-30T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const ahead = (ms: number) => new Date(NOW + ms).toISOString()

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
	it('returns empty string for missing or invalid input', () => {
		expect(formatRelativeTime(null, NOW)).toBe('')
		expect(formatRelativeTime(undefined, NOW)).toBe('')
		expect(formatRelativeTime('not-a-date', NOW)).toBe('')
	})

	it('formats recent past times', () => {
		expect(formatRelativeTime(ago(2 * MINUTE), NOW)).toBe('2 minutes ago')
		expect(formatRelativeTime(ago(3 * HOUR), NOW)).toBe('3 hours ago')
		expect(formatRelativeTime(ago(2 * DAY), NOW)).toBe('2 days ago')
	})

	it('formats future times (scheduled / waitUntil)', () => {
		expect(formatRelativeTime(ahead(90 * MINUTE), NOW)).toBe('in 2 hours')
		expect(formatRelativeTime(ahead(5 * MINUTE), NOW)).toBe('in 5 minutes')
	})

	it('accepts Date and epoch-millis input', () => {
		expect(formatRelativeTime(new Date(NOW - HOUR), NOW)).toBe('1 hour ago')
		expect(formatRelativeTime(NOW - DAY, NOW)).toBe('yesterday')
	})
})
