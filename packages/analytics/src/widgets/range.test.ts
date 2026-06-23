import { describe, expect, it } from 'vitest'
import { formatRangeCaption, resolveCustomRange } from './range'

describe('resolveCustomRange', () => {
	it('returns undefined for a relative preset', () => {
		expect(
			resolveCustomRange('last30days', { from: '2026-06-01', to: '2026-06-23' })
		).toBeUndefined()
	})
	it('returns undefined when the range is incomplete', () => {
		expect(resolveCustomRange('custom', { from: '2026-06-01' })).toBeUndefined()
		expect(resolveCustomRange('custom', undefined)).toBeUndefined()
	})
	it('returns a concrete range for a valid custom window', () => {
		const out = resolveCustomRange('custom', {
			from: '2026-06-01T00:00:00.000Z',
			to: '2026-06-23T00:00:00.000Z',
		})
		expect(out?.start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
		expect(out?.end.toISOString()).toBe('2026-06-23T00:00:00.000Z')
	})
	it('returns undefined when a bound is unparseable', () => {
		expect(resolveCustomRange('custom', { from: 'not-a-date', to: '2026-06-23' })).toBeUndefined()
		expect(resolveCustomRange('custom', { from: '2026-06-01', to: 'garbage' })).toBeUndefined()
	})
})

describe('formatRangeCaption', () => {
	it('joins the two formatted bounds with a hyphen', () => {
		const caption = formatRangeCaption(
			{ start: new Date('2026-06-01T12:00:00.000Z'), end: new Date('2026-06-23T12:00:00.000Z') },
			'en-US'
		)
		expect(caption).toContain(' - ')
		expect(caption).toMatch(/2026/)
	})
})
