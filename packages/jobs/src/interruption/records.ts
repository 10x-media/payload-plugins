import type { Payload } from 'payload'

import type { InterruptPolicy } from './policy'

const JOBS_SLUG = 'payload-jobs'
/** A record whose job never settled (another process, a crash) is dropped after this. */
const RECORD_TTL_MS = 60 * 60 * 1000

/** What the wrapper saw when a handler threw an interruption. */
export type InterruptionRecord = {
	outcome: InterruptPolicy
	until: Date
	by: string
	/** The interrupting error's message, kept on a failed job. */
	reason: string
	/** `totalTried` as claimed, restored on deferral. */
	totalTried: number
	/** Log entry ids present at claim; failed entries added since are the interrupted attempt's. */
	logIds: string[]
	recordedAt: number
}

type LogEntry = { id?: null | string; state?: null | string }

/** The slice of a `payload-jobs` row the fix-up reads. */
export type JobRow = {
	processing?: boolean | null
	totalTried?: null | number
	completedAt?: null | string
	log?: LogEntry[] | null
}

type Pending = { id: number | string; record: InterruptionRecord }

const stores = new WeakMap<Payload, Map<string, Pending>>()

const storeOf = (payload: Payload): Map<string, Pending> => {
	let store = stores.get(payload)
	if (!store) {
		store = new Map()
		stores.set(payload, store)
	}
	return store
}

/**
 * Remember an interruption until the run that hit it returns. The first record
 * for a job wins: the innermost wrapper sees the original error, the outer
 * ones only Payload's `TaskError` around it.
 */
export const recordInterruption = (
	payload: Payload,
	jobId: number | string,
	record: InterruptionRecord
): void => {
	const store = storeOf(payload)
	// Runs outside the worker never apply their records; drop the stale ones here.
	for (const [staleKey, pending] of store) {
		if (record.recordedAt - pending.record.recordedAt > RECORD_TTL_MS) {
			store.delete(staleKey)
		}
	}
	const key = String(jobId)
	if (!store.has(key)) {
		store.set(key, { id: jobId, record })
	}
}

/** Whether a record for `jobId` is waiting for the fix-up. */
export const hasInterruption = (payload: Payload, jobId: number | string): boolean =>
	storeOf(payload).has(String(jobId))

/**
 * The row update that turns Payload's failed or retrying state into the
 * recorded outcome. A deferral restores `totalTried` and drops the attempt's
 * failed log entries, so it spends no retry of the job or of its tasks.
 */
export const interruptionUpdate = (
	record: InterruptionRecord,
	row: JobRow
): Record<string, unknown> => {
	if (record.outcome === 'fail') {
		return {
			error: {
				name: 'JobInterrupted',
				message: `Interrupted by ${record.by}`,
				interruptedBy: record.by,
				reason: record.reason,
			},
			hasError: true,
			processing: false,
			waitUntil: null,
		}
	}
	const before = new Set(record.logIds)
	const log = row.log ?? []
	const kept = log.filter((entry) => entry.state !== 'failed' || before.has(entry.id ?? ''))
	return {
		deferredBy: record.by,
		error: null,
		hasError: false,
		processing: false,
		totalTried: record.totalTried,
		waitUntil: record.until.toISOString(),
		...(kept.length === log.length ? {} : { log: kept }),
	}
}

export type ApplyInterruptionsResult = { deferred: number; failed: number }

/**
 * What to do with a record, given the row as it is now. Payload bumps
 * `totalTried` by one when it records the failed attempt, so the record
 * applies to a settled row one try past the claim. A row still at the claim
 * and processing has not been written yet (wait). Any other row has moved on:
 * another node claimed the job again, so that node owns its outcome (drop).
 */
export const interruptionStep = (
	record: InterruptionRecord,
	row: JobRow | null
): 'apply' | 'drop' | 'wait' => {
	if (!row || row.completedAt) {
		return 'drop'
	}
	const tried = row.totalTried ?? 0
	if (row.processing) {
		return tried === record.totalTried ? 'wait' : 'drop'
	}
	return tried === record.totalTried + 1 ? 'apply' : 'drop'
}

/**
 * Apply every recorded interruption whose attempt Payload has finished
 * writing. The plugin's worker and `queue-run` call it after each run; call it
 * after `payload.jobs.run` in a custom run loop too. Writes go through
 * `payload.db` (no hooks).
 */
export const applyJobInterruptions = async (
	payload: Payload
): Promise<ApplyInterruptionsResult> => {
	const result: ApplyInterruptionsResult = { deferred: 0, failed: 0 }
	const store = stores.get(payload)
	if (!store?.size) {
		return result
	}
	const now = Date.now()
	for (const [key, { id, record }] of [...store]) {
		const row = (await payload.db.findOne({
			collection: JOBS_SLUG,
			where: { id: { equals: id } },
		})) as JobRow | null
		const step = interruptionStep(record, row)
		if (step === 'wait') {
			if (now - record.recordedAt > RECORD_TTL_MS) {
				store.delete(key)
			}
			continue
		}
		store.delete(key)
		if (step === 'drop' || !row) {
			continue
		}
		await payload.db.updateOne({
			collection: JOBS_SLUG,
			data: interruptionUpdate(record, row),
			id,
			returning: false,
		})
		result[record.outcome === 'defer' ? 'deferred' : 'failed'] += 1
	}
	return result
}
