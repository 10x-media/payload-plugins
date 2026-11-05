import { describe, expect, it } from 'vitest'

import { sessionEndsLabel } from './sessionEnds'

const endsAt = '2026-10-30T12:00:00.000Z'
const templates = { endsAt: 'Session ends at {{time}}', endsIn: 'Session ends in {{countdown}}' }
const at = (iso: string) => new Date(iso).getTime()

describe('session ends label', () => {
	it('renders no time before the bar has read the browser clock', () => {
		expect(sessionEndsLabel({ endsAt, now: null, templates })).toBeNull()
	})

	it('counts down once it has', () => {
		expect(sessionEndsLabel({ endsAt, now: at('2026-10-30T11:00:13.400Z'), templates })).toBe(
			'Session ends in 59m 46s'
		)
		expect(sessionEndsLabel({ endsAt, now: at('2026-10-30T09:59:58.000Z'), templates })).toBe(
			'Session ends in 2h 00m 02s'
		)
	})

	it('renders nothing once the session has ended or has no end', () => {
		expect(sessionEndsLabel({ endsAt, now: at('2026-10-30T12:00:00.000Z'), templates })).toBeNull()
		expect(sessionEndsLabel({ endsAt: null, now: at(endsAt), templates })).toBeNull()
	})
})
