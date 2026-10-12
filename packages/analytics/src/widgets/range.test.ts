import { describe, expect, it } from 'vitest'
import { formatRangeCaption, isUnreadableCustomRange, resolveCustomRange } from './range'

// The dayOnly picker stores the picked day at the admin browser's local midnight, so the
// same two days come back as different instants depending on where the admin sat.
const BERLIN_ADMIN = { from: '2026-05-31T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' }
const NEW_YORK_ADMIN = { from: '2026-06-01T04:00:00.000Z', to: '2026-06-23T04:00:00.000Z' }

describe('resolveCustomRange', () => {
	it('returns undefined for a relative preset', () => {
		expect(
			resolveCustomRange('last30days', { from: '2026-06-01', to: '2026-06-23' }, 'UTC')
		).toBeUndefined()
	})

	it('returns undefined when the range is incomplete', () => {
		expect(resolveCustomRange('custom', { from: '2026-06-01' }, 'UTC')).toBeUndefined()
		expect(resolveCustomRange('custom', undefined, 'UTC')).toBeUndefined()
	})

	it('reads the days a Berlin admin picked, in the reporting timezone', () => {
		const berlin = resolveCustomRange('custom', BERLIN_ADMIN, 'Europe/Berlin')
		expect(berlin?.start.toISOString()).toBe('2026-05-31T22:00:00.000Z')
		expect(berlin?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')

		const utc = resolveCustomRange('custom', BERLIN_ADMIN, 'UTC')
		expect(utc?.start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
		expect(utc?.end.toISOString()).toBe('2026-06-23T23:59:59.999Z')
	})

	it('reads the days a New York admin picked as the same two days', () => {
		const berlin = resolveCustomRange('custom', NEW_YORK_ADMIN, 'Europe/Berlin')
		expect(berlin?.start.toISOString()).toBe('2026-05-31T22:00:00.000Z')
		expect(berlin?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')

		const utc = resolveCustomRange('custom', NEW_YORK_ADMIN, 'UTC')
		expect(utc?.start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
		expect(utc?.end.toISOString()).toBe('2026-06-23T23:59:59.999Z')
	})

	it('accepts day strings directly', () => {
		const out = resolveCustomRange(
			'custom',
			{ from: '2026-06-01', to: '2026-06-23' },
			'Europe/Berlin'
		)
		expect(out?.start.toISOString()).toBe('2026-05-31T22:00:00.000Z')
		expect(out?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')
	})

	it('covers a single picked day end to end', () => {
		const out = resolveCustomRange(
			'custom',
			{ from: '2026-06-22T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' },
			'Europe/Berlin'
		)
		expect(out?.start.toISOString()).toBe('2026-06-22T22:00:00.000Z')
		expect(out?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')
	})

	it('returns undefined when a bound is unparseable', () => {
		expect(
			resolveCustomRange('custom', { from: 'not-a-date', to: '2026-06-23' }, 'UTC')
		).toBeUndefined()
		expect(
			resolveCustomRange('custom', { from: '2026-06-01', to: 'garbage' }, 'UTC')
		).toBeUndefined()
		expect(
			resolveCustomRange('custom', { from: '2026-02-30', to: '2026-06-23' }, 'UTC')
		).toBeUndefined()
	})
})

describe('formatRangeCaption', () => {
	it('names the picked days for both admins, in the reporting timezone', () => {
		for (const stored of [BERLIN_ADMIN, NEW_YORK_ADMIN]) {
			for (const tz of ['Europe/Berlin', 'UTC']) {
				const range = resolveCustomRange('custom', stored, tz)
				if (!range) {
					throw new Error('range did not resolve')
				}
				expect(formatRangeCaption(range, 'en', tz)).toBe('Jun 1 \u2013 23, 2026')
			}
		}
	})

	// What both ends share is said once, in the language's own order, and one day is one date.
	it('writes the span as the language writes one', () => {
		const range = (from: string, to: string) => ({ start: new Date(from), end: new Date(to) })
		expect(
			formatRangeCaption(range('2026-06-01T12:00:00Z', '2026-07-03T12:00:00Z'), 'en', 'UTC')
		).toBe('Jun 1 \u2013 Jul 3, 2026')
		expect(
			formatRangeCaption(range('2026-06-01T12:00:00Z', '2026-06-23T12:00:00Z'), 'de', 'UTC')
		).toBe('1.\u201323. Juni 2026')
		expect(
			formatRangeCaption(range('2026-06-01T12:00:00Z', '2026-06-01T20:00:00Z'), 'en', 'UTC')
		).toBe('Jun 1, 2026')
	})

	// The view's toolbar renders it on the server and again in the browser, which must agree.
	it('spaces the span as browsers do, never with the thin spaces Node writes', () => {
		const caption = formatRangeCaption(
			{ start: new Date('2025-10-09T12:00:00Z'), end: new Date('2026-10-08T12:00:00Z') },
			'en',
			'UTC'
		)
		expect(caption).toBe('Oct 9, 2025 \u2013 Oct 8, 2026')
		expect(caption).not.toMatch(/[\u2009\u202f]/)
	})
})

describe('isUnreadableCustomRange', () => {
	it('flags a range that reaches before 1970, as a day or as a picked midnight', () => {
		expect(isUnreadableCustomRange('custom', { from: '1969-12-01', to: '1970-01-05' })).toBe(true)
		expect(
			isUnreadableCustomRange('custom', {
				from: '1969-11-30T23:00:00.000Z',
				to: '1970-01-04T23:00:00.000Z',
			})
		).toBe(true)
	})

	it('flags a bound that names no real day', () => {
		expect(isUnreadableCustomRange('custom', { from: '2026-02-30', to: '2026-06-23' })).toBe(true)
		expect(isUnreadableCustomRange('custom', { from: '2026-06-01', to: 'garbage' })).toBe(true)
	})

	it('leaves a readable, incomplete or preset range alone', () => {
		expect(isUnreadableCustomRange('custom', { from: '1970-01-01', to: '1970-01-05' })).toBe(false)
		expect(isUnreadableCustomRange('custom', { from: '1969-12-01' })).toBe(false)
		expect(isUnreadableCustomRange('custom', undefined)).toBe(false)
		expect(isUnreadableCustomRange('last30days', { from: '1969-12-01', to: '1970-01-05' })).toBe(
			false
		)
	})
})
