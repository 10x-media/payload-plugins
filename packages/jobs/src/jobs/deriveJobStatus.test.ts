import { validateWhereQuery } from 'payload/shared'
import { describe, expect, it } from 'vitest'

import { deriveJobStatus, type JobStatus, statusWhere } from './deriveJobStatus'

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

	it('is running while its claim lease holds, regardless of prior attempts', () => {
		expect(deriveJobStatus({ processingUntil: future }, NOW)).toBe('running')
		expect(deriveJobStatus({ processingUntil: future, totalTried: 3 }, NOW)).toBe('running')
	})

	it('is not running once the claim lease has lapsed (the run died)', () => {
		expect(deriveJobStatus({ processingUntil: past }, NOW)).toBe('queued')
		expect(deriveJobStatus({ processingUntil: past, totalTried: 1 }, NOW)).toBe('retrying')
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
		expect(deriveJobStatus({ processingUntil: future, hasError: true }, NOW)).toBe('running')
	})

	it('prioritises a terminal error over completion', () => {
		expect(deriveJobStatus({ hasError: true, completedAt: past }, NOW)).toBe('failed')
	})
})

describe('statusWhere', () => {
	const statuses: JobStatus[] = [
		'cancelled',
		'failed',
		'queued',
		'retrying',
		'running',
		'scheduled',
		'succeeded',
	]

	it.each(statuses)('%s is in the filter builder shape', (status) => {
		expect(validateWhereQuery(statusWhere(status, NOW))).toBe(true)
	})
})
