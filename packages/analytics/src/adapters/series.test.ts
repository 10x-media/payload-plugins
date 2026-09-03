import { describe, expect, it } from 'vitest'
import { dayIso, hourIso } from './series'

describe('dayIso', () => {
	it('normalizes a YYYY-MM-DD date to a UTC day ISO string', () => {
		expect(dayIso('2026-06-23')).toBe('2026-06-23T00:00:00.000Z')
	})
	it('truncates a longer datetime to its UTC day', () => {
		expect(dayIso('2026-06-23 14:35:00')).toBe('2026-06-23T00:00:00.000Z')
		expect(dayIso('2026-06-23T14:35:00Z')).toBe('2026-06-23T00:00:00.000Z')
	})
	it('returns null for an unparseable value', () => {
		expect(dayIso('not-a-date')).toBeNull()
		expect(dayIso('')).toBeNull()
	})
	it('returns null for a year-only or year-month value (not a full day)', () => {
		expect(dayIso('2026')).toBeNull()
		expect(dayIso('2026-01')).toBeNull()
	})
})

describe('hourIso', () => {
	it('normalizes a space-separated datetime to a UTC ISO string', () => {
		expect(hourIso('2026-06-23 14:00:00')).toBe('2026-06-23T14:00:00.000Z')
	})
	it('normalizes a T-separated datetime the same way', () => {
		expect(hourIso('2026-06-23T14:00:00')).toBe('2026-06-23T14:00:00.000Z')
	})
	it('returns null for a value shorter than a full datetime', () => {
		expect(hourIso('2026-06-23')).toBeNull()
		expect(hourIso('')).toBeNull()
	})
	it('returns null for an unparseable value', () => {
		expect(hourIso('2026-13-45 99:99:99')).toBeNull()
	})
})
