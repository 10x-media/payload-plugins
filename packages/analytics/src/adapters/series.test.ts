import { describe, expect, it } from 'vitest'
import { dayIso } from './series'

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
})
