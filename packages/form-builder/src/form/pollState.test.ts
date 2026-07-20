import { describe, expect, it } from 'vitest'
import { isPollClosed, pollConfigOf } from './pollState'

describe('pollConfigOf', () => {
	it('returns the poll object when present', () => {
		expect(pollConfigOf({ resultsField: 'winner' })).toEqual({ resultsField: 'winner' })
	})

	it('returns undefined for a missing or null poll', () => {
		expect(pollConfigOf(undefined)).toBeUndefined()
		expect(pollConfigOf(null)).toBeUndefined()
	})

	it('returns undefined for a non-object poll', () => {
		expect(pollConfigOf('yes')).toBeUndefined()
	})
})

describe('isPollClosed', () => {
	it('is false without a poll or closesAt', () => {
		expect(isPollClosed(undefined)).toBe(false)
		expect(isPollClosed(null)).toBe(false)
		expect(isPollClosed({})).toBe(false)
		expect(isPollClosed({ closesAt: null })).toBe(false)
		expect(isPollClosed({ closesAt: '' })).toBe(false)
	})

	it('is false before closesAt and true after', () => {
		const now = Date.parse('2026-07-14T12:00:00.000Z')
		expect(isPollClosed({ closesAt: '2026-07-14T12:00:01.000Z' }, now)).toBe(false)
		expect(isPollClosed({ closesAt: '2026-07-14T11:59:59.000Z' }, now)).toBe(true)
	})

	it('treats the exact closesAt instant as closed', () => {
		const now = Date.parse('2026-07-14T12:00:00.000Z')
		expect(isPollClosed({ closesAt: '2026-07-14T12:00:00.000Z' }, now)).toBe(true)
	})

	it('never closes on an unparseable closesAt', () => {
		expect(isPollClosed({ closesAt: 'not a date' })).toBe(false)
	})
})
