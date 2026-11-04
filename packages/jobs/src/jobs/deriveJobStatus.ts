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
	processingUntil?: null | string
	totalTried?: null | number
	waitUntil?: null | string
}

const isCancelled = (error: unknown): boolean =>
	typeof error === 'object' &&
	error !== null &&
	(error as { cancelled?: unknown }).cancelled === true

/**
 * Collapse a job's raw fields into one status. Payload has no status field; the
 * state lives across `processingUntil`, `hasError`, `error.cancelled`, `completedAt`,
 * `waitUntil`, and `totalTried`. Order matters: the first matching rule wins.
 *
 * A job is running while a runner holds its claim: Payload 4 sets `processingUntil`
 * on claim, renews it while the job runs, and clears it when the run ends. A lapsed
 * lease is a run that died, and the job reads as whatever it was before it.
 */
export const deriveJobStatus = (job: JobStatusInput, now: number = Date.now()): JobStatus => {
	if (job.processingUntil && new Date(job.processingUntil).getTime() > now) {
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

const NO_ERROR: Where = { hasError: { equals: false } }
const NOT_COMPLETED: Where = { completedAt: { exists: false } }
const NOT_TRIED: Where = { totalTried: { equals: 0 } }

/**
 * Expand a conjunction into the `{ or: [{ and: [...] }] }` shape the admin's
 * filter builder edits; it shows nothing for a nested `or`. A term that is an
 * array is a set of alternatives, so the result has one `and` group per
 * combination of them.
 */
const anyOfAll = (...terms: Array<Where | Where[]>): Where => {
	let groups: Where[][] = [[]]
	for (const term of terms) {
		const alternatives = Array.isArray(term) ? term : [term]
		groups = groups.flatMap((group) => alternatives.map((alt) => [...group, alt]))
	}
	return { or: groups.map((and) => ({ and })) }
}

/**
 * A Payload `where` selecting exactly the jobs `deriveJobStatus` would label with
 * `status`. Each clause negates the higher-precedence rules so the seven
 * partition the collection; the health bar counts each with `payload.count`, and
 * a cross-DB test asserts the counts match `deriveJobStatus` row for row.
 * `hasError`/`totalTried` always carry their Payload defaults (`false`/`0`), so
 * the boolean and number clauses are null-safe. The result is in the filter
 * builder's shape, so a status picked in the health bar is editable in Filters.
 */
export const statusWhere = (status: JobStatus, now: number = Date.now()): Where => {
	const at = new Date(now).toISOString()
	const NOT_RUNNING: Where[] = [
		{ processingUntil: { exists: false } },
		{ processingUntil: { less_than_equal: at } },
	]
	switch (status) {
		case 'running':
			return anyOfAll({ processingUntil: { greater_than: at } })
		case 'cancelled':
			return anyOfAll(
				NOT_RUNNING,
				{ hasError: { equals: true } },
				{
					'error.cancelled': { equals: true },
				}
			)
		case 'failed':
			return anyOfAll(NOT_RUNNING, { hasError: { equals: true } }, [
				{ 'error.cancelled': { exists: false } },
				{ 'error.cancelled': { equals: false } },
			])
		case 'succeeded':
			return anyOfAll(NOT_RUNNING, NO_ERROR, { completedAt: { exists: true } })
		case 'retrying':
			return anyOfAll(NOT_RUNNING, NO_ERROR, NOT_COMPLETED, { totalTried: { greater_than: 0 } })
		case 'scheduled':
			return anyOfAll(NOT_RUNNING, NO_ERROR, NOT_COMPLETED, NOT_TRIED, {
				waitUntil: { greater_than: at },
			})
		case 'queued':
			return anyOfAll(NOT_RUNNING, NO_ERROR, NOT_COMPLETED, NOT_TRIED, [
				{ waitUntil: { exists: false } },
				{ waitUntil: { less_than_equal: at } },
			])
	}
}
