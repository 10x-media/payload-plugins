import { describe, expect, it } from 'vitest'

import { formatDuration } from './formatDuration'

const base = '2026-01-01T00:00:00.000Z'
const at = (ms: number): string => new Date(Date.parse(base) + ms).toISOString()

describe('formatDuration', () => {
	it('is undefined when an endpoint is missing', () => {
		expect(formatDuration(undefined, undefined)).toBeUndefined()
		expect(formatDuration(base, undefined)).toBeUndefined()
		expect(formatDuration(undefined, base)).toBeUndefined()
	})

	it('is undefined for zero or negative spans', () => {
		expect(formatDuration(base, base)).toBeUndefined()
		expect(formatDuration(at(1000), base)).toBeUndefined()
	})

	it('is undefined for unparseable timestamps', () => {
		expect(formatDuration('nope', 'also nope')).toBeUndefined()
	})

	it('formats sub-second spans in milliseconds', () => {
		expect(formatDuration(base, at(250))).toBe('250ms')
	})

	it('formats short spans with one decimal second', () => {
		expect(formatDuration(base, at(2500))).toBe('2.5s')
	})

	it('formats spans of ten seconds or more as whole seconds', () => {
		expect(formatDuration(base, at(42_000))).toBe('42s')
	})
})
