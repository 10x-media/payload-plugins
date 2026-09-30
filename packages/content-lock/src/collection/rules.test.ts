import { describe, expect, it } from 'vitest'

import type { LockWindow } from '../state/types'
import { keys } from '../translations/keys'
import { checkWindowChange } from './rules'

const now = new Date('2026-01-10T12:00:00.000Z')

const window = (overrides: Partial<LockWindow> = {}): LockWindow => ({
	id: 'w1',
	title: 'Window',
	announceAt: null,
	startsAt: '2026-01-11T00:00:00.000Z',
	endMode: 'manual',
	endsAt: null,
	endedAt: null,
	scope: 'everything',
	targets: [],
	...overrides,
})

describe('checkWindowChange', () => {
	it('accepts a valid new window', () => {
		expect(checkWindowChange(null, window(), now)).toBeNull()
	})

	it('rejects an announcement after the start', () => {
		expect(checkWindowChange(null, window({ announceAt: '2026-01-12T00:00:00.000Z' }), now)).toBe(
			keys.errorAnnounceAfterStart
		)
	})

	it('requires a later end for timed windows', () => {
		expect(checkWindowChange(null, window({ endMode: 'at' }), now)).toBe(keys.errorEndsAtRequired)
		expect(
			checkWindowChange(null, window({ endMode: 'at', endsAt: '2026-01-11T00:00:00.000Z' }), now)
		).toBe(keys.errorEndBeforeStart)
	})

	it('requires targets for a selected scope', () => {
		expect(checkWindowChange(null, window({ scope: 'selected' }), now)).toBe(
			keys.errorTargetsRequired
		)
	})

	it('freezes ended windows', () => {
		const ended = window({
			startsAt: '2026-01-01T00:00:00.000Z',
			endedAt: '2026-01-02T00:00:00.000Z',
		})
		expect(checkWindowChange(ended, { ...ended, title: 'Renamed' }, now)).toBe(
			keys.errorEndedReadOnly
		)
	})

	it('keeps an active window from moving into the future', () => {
		const active = window({ startsAt: '2026-01-10T00:00:00.000Z' })
		expect(
			checkWindowChange(active, { ...active, startsAt: '2026-01-11T00:00:00.000Z' }, now)
		).toBe(keys.errorActiveStartMoved)
		expect(checkWindowChange(active, { ...active, endedAt: now.toISOString() }, now)).toBeNull()
	})
})
