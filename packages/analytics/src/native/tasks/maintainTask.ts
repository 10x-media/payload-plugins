import type { PayloadRequest, TaskConfig } from 'payload'
import { type ScheduledTask, TASK_SLUGS } from '../../core/jobs'
import { isRecord } from '../../core/values'
import { leaseHeld } from '../../maintenance/lease'
import {
	type BeforeSchedule,
	concurrencyFor,
	scheduleFor,
	stuckJobGuard,
} from '../../maintenance/taskSchedule'
import type { MaintainReport } from '../engine/maintenance'
import { checkRebuildInput, type RebuildDaysInput } from '../engine/rebuild'
import { DAY_LEASE_MS, MAINTAIN_LEASE_NAME } from '../store/state'

export const MAINTAIN_TASK_SLUG = TASK_SLUGS.maintain

/** How long one run of the task works before it leaves the rest to the next. */
export const MAINTAIN_TASK_BUDGET_MS = 240_000

/** A run still processing this long after its last update was killed: no live run lasts longer. */
export const MAINTAIN_DEAD_AFTER_MS = MAINTAIN_TASK_BUDGET_MS + DAY_LEASE_MS

/**
 * Marks a killed run failed, then Payload's own rule: no second run while one is queued or
 * processing. A run renewing the maintenance lease is alive however long its job has run.
 */
export const beforeMaintainSchedule: BeforeSchedule = stuckJobGuard({
	slug: MAINTAIN_TASK_SLUG,
	deadAfterMs: MAINTAIN_DEAD_AFTER_MS,
	alive: (req) => leaseHeld(req.payload, MAINTAIN_LEASE_NAME),
})

/**
 * The task's input when queued by hand: a stretch of days to count again. A job's input is stored
 * as JSON, so the instants arrive as ISO text whichever way they were queued.
 */
export interface MaintainTaskInput {
	rebuild?: {
		scope?: string
		from: string | Date
		to: string | Date
		reclassify?: boolean
	}
}

const refuse = (message: string): never => {
	throw new Error(`analytics: the ${MAINTAIN_TASK_SLUG} task's ${message}`)
}

const instantOf = (value: unknown, name: string): Date => {
	const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
	return date !== null && !Number.isNaN(date.getTime())
		? date
		: refuse(`rebuild.${name} must be an ISO instant`)
}

/** The task's input checked: a rebuild needs two instants, and anything malformed fails the job. */
export const parseMaintainInput = (input: unknown): { rebuild?: RebuildDaysInput } => {
	if (input === undefined || input === null) {
		return {}
	}
	if (!isRecord(input) || Array.isArray(input)) {
		return refuse('input must be an object such as { rebuild: { from, to } }')
	}
	const { rebuild } = input
	if (rebuild === undefined || rebuild === null) {
		return {}
	}
	if (!isRecord(rebuild) || Array.isArray(rebuild)) {
		return refuse('rebuild must be an object such as { from, to }')
	}
	const { scope, reclassify } = rebuild
	if (scope !== undefined && typeof scope !== 'string') {
		refuse('rebuild.scope must be a scope id')
	}
	if (reclassify !== undefined && typeof reclassify !== 'boolean') {
		refuse('rebuild.reclassify must be true or false')
	}
	return {
		rebuild: checkRebuildInput({
			from: instantOf(rebuild.from, 'from'),
			to: instantOf(rebuild.to, 'to'),
			...(typeof scope === 'string' ? { scope } : {}),
			...(typeof reclassify === 'boolean' ? { reclassify } : {}),
		}),
	}
}

/** What one run did: the engine's upkeep, and the expired read cache entries it deleted. */
export interface MaintainTaskOutput extends MaintainReport {
	sweptCache: number
}

/**
 * The concurrency key of a run: `analytics:maintain` for upkeep, and one per rebuild window, so a
 * scheduled run never replaces a rebuild someone queued.
 */
const maintainKey = (input: unknown): string => {
	const rebuild = isRecord(input) ? input.rebuild : undefined
	if (!isRecord(rebuild)) {
		return 'analytics:maintain'
	}
	const part = (value: unknown): string =>
		value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : ''
	return `analytics:maintain:rebuild:${part(rebuild.scope)}:${part(rebuild.from)}:${part(rebuild.to)}`
}

/**
 * Never retried: the next run carries on. The leases a run takes, not Payload's concurrency keys,
 * keep two runs from doing the work twice.
 */
export const maintainTask = (args: {
	schedule: ScheduledTask
	run: (req: PayloadRequest, input: { rebuild?: RebuildDaysInput }) => Promise<MaintainTaskOutput>
	/** Host's `jobs.enableConcurrencyControl`, without which Payload refuses a concurrency key. */
	concurrency?: boolean
}): TaskConfig<{ input: MaintainTaskInput; output: MaintainTaskOutput }> => ({
	slug: MAINTAIN_TASK_SLUG,
	retries: 0,
	handler: async ({ input, req }) => ({ output: await args.run(req, parseMaintainInput(input)) }),
	...scheduleFor(args.schedule, beforeMaintainSchedule),
	...concurrencyFor('maintain', args.concurrency === true, maintainKey),
})
