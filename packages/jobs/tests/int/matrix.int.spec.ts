import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { TaskConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { jobs } from '../../src/index'
import {
	deriveJobStatus,
	type JobStatus,
	type JobStatusInput,
	statusWhere,
} from '../../src/jobs/deriveJobStatus'

const STATUSES: JobStatus[] = [
	'queued',
	'scheduled',
	'retrying',
	'running',
	'succeeded',
	'failed',
	'cancelled',
]

/** payload-jobs only materializes when the host configures a task; this minimal one does. */
const noopTask: TaskConfig<'noop'> = {
	slug: 'noop',
	handler: () => ({ output: {} }),
}

describeForDb('jobs cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({}),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('statusWhere counts agree with deriveJobStatus on every status', async () => {
		const { payload } = booted
		const now = Date.now()
		const future = new Date(now + 3_600_000).toISOString()
		const past = new Date(now - 60_000).toISOString()

		// One job per derived status; the `error.cancelled` JSON query and the
		// null-safe boolean clauses are what differ across Mongo and Postgres.
		const rows: JobStatusInput[] = [
			{ totalTried: 0 },
			{ totalTried: 0, waitUntil: future },
			{ totalTried: 2 },
			{ processing: true },
			{ completedAt: past, totalTried: 1 },
			{ hasError: true, error: { message: 'boom' }, totalTried: 3 },
			{ hasError: true, error: { cancelled: true } },
		]

		const expected: Record<JobStatus, number> = {
			cancelled: 0,
			failed: 0,
			queued: 0,
			retrying: 0,
			running: 0,
			scheduled: 0,
			succeeded: 0,
		}
		for (const row of rows) {
			await payload.create({
				collection: 'payload-jobs',
				data: { ...row, workflowSlug: 'runAutomation' } as never,
			})
			expected[deriveJobStatus(row, now)] += 1
		}

		let counted = 0
		for (const status of STATUSES) {
			const { totalDocs } = await payload.count({
				collection: 'payload-jobs',
				where: statusWhere(status, now),
			})
			expect(totalDocs, `status ${status}`).toBe(expected[status])
			counted += totalDocs
		}

		// The seven clauses partition the collection: every job counted exactly once.
		expect(counted).toBe(rows.length)
	})
})
