import { describe, expect, it } from 'vitest'

import { deriveJobStatus } from './deriveJobStatus'

const NOW = Date.parse('2026-05-30T12:00:00.000Z')
const future = new Date(NOW + 60_000).toISOString()
const past = new Date(NOW - 60_000).toISOString()

describe('deriveJobStatus', () => {
	it('is queued when fresh', () => {
		expect(deriveJobStatus({}, NOW)).toBe('queued')
		expect(deriveJobStatus({ totalTried: 0 }, NOW)).toBe('queued')
	})

	it('is scheduled when waitUntil is in the future and never tried', () => {
		expect(deriveJobStatus({ waitUntil: future, totalTried: 0 }, NOW)).toBe('scheduled')
	})

	it('is queued (not scheduled) once waitUntil has passed', () => {
		expect(deriveJobStatus({ waitUntil: past, totalTried: 0 }, NOW)).toBe('queued')
	})

	it('is retrying after a failed attempt that is not yet terminal', () => {
		expect(deriveJobStatus({ totalTried: 2 }, NOW)).toBe('retrying')
		expect(deriveJobStatus({ totalTried: 2, waitUntil: future }, NOW)).toBe('retrying')
	})

	it('is running while processing, regardless of prior attempts', () => {
		expect(deriveJobStatus({ processing: true }, NOW)).toBe('running')
		expect(deriveJobStatus({ processing: true, totalTried: 3 }, NOW)).toBe('running')
	})

	it('is succeeded when completed without error', () => {
		expect(deriveJobStatus({ completedAt: past, totalTried: 1 }, NOW)).toBe('succeeded')
	})

	it('is failed on a terminal error', () => {
		expect(
			deriveJobStatus({ hasError: true, error: { message: 'boom' }, totalTried: 3 }, NOW)
		).toBe('failed')
	})

	it('is cancelled when the terminal error is a cancellation', () => {
		expect(deriveJobStatus({ hasError: true, error: { cancelled: true } }, NOW)).toBe('cancelled')
	})

	it('prioritises running over a terminal error (a re-picked-up job)', () => {
		expect(deriveJobStatus({ processing: true, hasError: true }, NOW)).toBe('running')
	})

	it('prioritises a terminal error over completion', () => {
		expect(deriveJobStatus({ hasError: true, completedAt: past }, NOW)).toBe('failed')
	})
})
