import { describe, expect, it } from 'vitest'
import { formatRangeCaption, resolveCustomRange } from './range'

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
				expect(formatRangeCaption(range, 'en', tz)).toBe('Jun 1, 2026 - Jun 23, 2026')
			}
		}
	})
})
