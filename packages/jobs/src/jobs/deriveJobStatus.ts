import type { Where } from 'payload'

/** The seven derived job states, by precedence (see `deriveJobStatus`). */
export type JobStatus =
	| 'cancelled'
	| 'failed'
	| 'queued'
	| 'retrying'
	| 'running'
	| 'scheduled'
	| 'succeeded'

/** The subset of `payload-jobs` fields a status is derived from. */
export interface JobStatusInput {
	completedAt?: null | string
	error?: unknown
	hasError?: boolean | null
	processing?: boolean | null
	totalTried?: null | number
	waitUntil?: null | string
}

const isCancelled = (error: unknown): boolean =>
	typeof error === 'object' &&
	error !== null &&
	(error as { cancelled?: unknown }).cancelled === true

/**
 * Collapse a job's raw fields into one status. Payload has no status field; the
 * state lives across `processing`, `hasError`, `error.cancelled`, `completedAt`,
 * `waitUntil`, and `totalTried`. Order matters: the first matching rule wins.
 */
export const deriveJobStatus = (job: JobStatusInput, now: number = Date.now()): JobStatus => {
	if (job.processing === true) {
		return 'running'
	}
	if (job.hasError === true) {
		return isCancelled(job.error) ? 'cancelled' : 'failed'
	}
	if (job.completedAt) {
		return 'succeeded'
	}
	if ((job.totalTried ?? 0) > 0) {
		return 'retrying'
	}
	if (job.waitUntil && new Date(job.waitUntil).getTime() > now) {
		return 'scheduled'
	}
	return 'queued'
}

const NOT_RUNNING: Where = { processing: { not_equals: true } }
const NO_ERROR: Where = { hasError: { equals: false } }
const NOT_COMPLETED: Where = { completedAt: { exists: false } }
const NOT_TRIED: Where = { totalTried: { equals: 0 } }

/**
 * A Payload `where` selecting exactly the jobs `deriveJobStatus` would label with
 * `status`. Each clause negates the higher-precedence rules so the seven
 * partition the collection; the health bar counts each with `payload.count`, and
 * a cross-DB test asserts the counts match `deriveJobStatus` row for row.
 * `processing`/`hasError`/`totalTried` always carry their Payload defaults
 * (`false`/`false`/`0`), so the boolean and number clauses are null-safe.
 */
export const statusWhere = (status: JobStatus, now: number = Date.now()): Where => {
	const at = new Date(now).toISOString()
	const clauses: Record<JobStatus, Where> = {
		running: { processing: { equals: true } },
		cancelled: {
			and: [NOT_RUNNING, { hasError: { equals: true } }, { 'error.cancelled': { equals: true } }],
		},
		failed: {
			and: [
				NOT_RUNNING,
				{ hasError: { equals: true } },
				{
					or: [{ 'error.cancelled': { exists: false } }, { 'error.cancelled': { equals: false } }],
				},
			],
		},
		succeeded: { and: [NOT_RUNNING, NO_ERROR, { completedAt: { exists: true } }] },
		retrying: { and: [NOT_RUNNING, NO_ERROR, NOT_COMPLETED, { totalTried: { greater_than: 0 } }] },
		scheduled: {
			and: [NOT_RUNNING, NO_ERROR, NOT_COMPLETED, NOT_TRIED, { waitUntil: { greater_than: at } }],
		},
		queued: {
			and: [
				NOT_RUNNING,
				NO_ERROR,
				NOT_COMPLETED,
				NOT_TRIED,
				{ or: [{ waitUntil: { exists: false } }, { waitUntil: { less_than_equal: at } }] },
			],
		},
	}
	return clauses[status]
}
