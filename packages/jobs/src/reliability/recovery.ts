import type { Payload, Where } from 'payload'
import { getCurrentDate } from 'payload'

import { getOrCreateCounter, type InFlightCounter } from '../execution/inFlight'
import type { ResolvedReliabilityOptions } from './options'
import { decideRecovery } from './recoveryDecision'

const JOBS_SLUG = 'payload-jobs'

/** A Payload job id: a string on Mongo (ObjectId), a number on SQL adapters. */
export type JobId = number | string

/** The slice of a claimed job the recovery layer reads. */
export type RecoveryJob = {
	id: JobId
	claimedBy?: null | string
	processingToken?: null | string
	recoveryAttempts?: null | number
	workflowSlug?: null | string
}

/** The slice of a handler's args the recovery layer needs. Real handlers pass a superset. */
export type RecoveryHandlerArgs = {
	job: RecoveryJob
	req: { payload: Payload }
}

/** A job handler reduced to what the recovery layer sees. */
export type JobHandler = (args: RecoveryHandlerArgs) => unknown

/** What the recovery layer needs, resolved at config time. */
export type RecoveryPlan = { options: ResolvedReliabilityOptions; ownerId: string }

/** Wraps one handler; `task` handlers leave the job to an enclosing wrapped workflow. */
export type RecoveryLayer = (handler: JobHandler, kind: 'task' | 'workflow') => JobHandler

/** The error written on a job that reached the recovery cap. */
const deadLetterError = (attempts: number): Record<string, unknown> => ({
	cancelled: false,
	message: `@10x-media/jobs: dead-lettered after reaching the recovery cap (${attempts} attempts)`,
	recovered: false,
})

/**
 * A write only the runner holding the job's current claim can make: Payload
 * replaces `processingToken` on every claim, so a revived worker writing after
 * another node took the job matches nothing.
 */
const claimed = (job: RecoveryJob): Where => ({
	and: [
		{ id: { equals: job.id } },
		{ processingToken: { equals: job.processingToken } },
		{ processingUntil: { greater_than: getCurrentDate().toISOString() } },
	],
})

const write = async (
	payload: Payload,
	job: RecoveryJob,
	data: Record<string, unknown>
): Promise<boolean> => {
	const updated = await payload.db.updateJobs({
		data: { ...data, updatedAt: getCurrentDate().toISOString() },
		limit: 1,
		returning: true,
		where: claimed(job),
	})
	return (updated?.length ?? 0) > 0
}

export type WithRecoveryArgs = {
	handler: JobHandler
	options: ResolvedReliabilityOptions
	ownerId: string
	/** Process-local counter incremented while the handler is executing. */
	counter?: InFlightCounter
	/**
	 * True when an enclosing workflow's wrapper already tracks this job. A task run
	 * by a workflow shares the workflow's job row, so marking it again would clear
	 * the workflow's marker when the task returns.
	 */
	trackedByWorkflow?: (job: RecoveryJob) => boolean
}

/**
 * Wrap one job handler so a run that never finished is noticed the next time the
 * job is claimed. Payload 4 owns the claim itself: `processingUntil` is a lease
 * its runner renews, and a job whose worker died becomes claimable again once
 * it lapses, without spending a retry. What Payload does not do is give up on a
 * job that keeps killing its worker; this layer adds that.
 *
 * On entry the wrapper marks the row with this node (`claimedBy`) and the start
 * time, and clears the mark when the handler returns or throws. A claim that
 * finds the mark still set therefore follows a run that died mid-handler: it
 * counts a recovery, and at `maxRecoveries` dead-letters the job (failed, never
 * retried) instead of running it. Every write is fenced on the claim's
 * `processingToken`, so a worker that lost the job cannot touch it.
 */
export const withRecovery = (args: WithRecoveryArgs): JobHandler => {
	const { counter, handler, options, ownerId, trackedByWorkflow } = args

	return async (handlerArgs: RecoveryHandlerArgs): Promise<unknown> => {
		const { job, req } = handlerArgs
		if (trackedByWorkflow?.(job) || !job.processingToken) {
			return handler(handlerArgs)
		}
		const payload = req.payload
		const attempts = job.recoveryAttempts ?? 0

		if (job.claimedBy) {
			if (decideRecovery(attempts, options.maxRecoveries) === 'deadLetter') {
				await write(payload, job, {
					claimedBy: null,
					completedAt: null,
					error: deadLetterError(attempts),
					hasError: true,
					processingUntil: null,
					waitUntil: null,
				})
				payload.logger.warn(
					`@10x-media/jobs: job ${job.id} dead-lettered after ${attempts} recoveries`
				)
				// The handler never runs. The dead letter cleared the lease, so the
				// success write Payload attempts next fails its own lease check and the
				// run ends as aborted, leaving the dead letter in place.
				return { output: {} }
			}
		}

		const marked = await write(payload, job, {
			claimedBy: ownerId,
			recoveryAttempts: job.claimedBy ? attempts + 1 : attempts,
			startedAt: getCurrentDate().toISOString(),
		})

		counter?.increment(job.id)
		try {
			return await handler(handlerArgs)
		} finally {
			counter?.decrement(job.id)
			if (marked) {
				await write(payload, job, { claimedBy: null }).catch((err: unknown) => {
					payload.logger.warn(
						`@10x-media/jobs: could not clear the run mark of job ${job.id}: ${String(err)}`
					)
				})
			}
		}
	}
}

/**
 * The recovery layer for `wrapJobHandlers`. A task that runs inside a workflow
 * with a function handler leaves the job to the workflow; a single-task job,
 * which Payload runs through an internal workflow nobody wraps, tracks itself.
 */
export const createRecoveryLayer = (
	plan: RecoveryPlan,
	workflows: ReadonlyArray<{ slug: string; handler?: unknown }>
): RecoveryLayer => {
	// The worker's drain loop reads the same counter through getOrCreateCounter(ownerId).
	const counter = getOrCreateCounter(plan.ownerId)

	const wrappedWorkflows = new Set(
		workflows
			.filter((workflow) => typeof workflow.handler === 'function')
			.map((workflow) => workflow.slug)
	)
	const trackedByWorkflow = (job: RecoveryJob): boolean =>
		typeof job.workflowSlug === 'string' && wrappedWorkflows.has(job.workflowSlug)

	return (handler, kind) =>
		withRecovery({
			counter,
			handler,
			options: plan.options,
			ownerId: plan.ownerId,
			trackedByWorkflow: kind === 'task' ? trackedByWorkflow : undefined,
		})
}

/**
 * Hand this node's still-running jobs back to the queue on a drain that timed
 * out: their lease is cleared, so another node can claim them at once instead
 * of after `jobs.processingLease.duration`, and the old run's own writes fail
 * Payload's lease check from then on. The run mark stays, so the next claim
 * counts the recovery. Returns how many jobs were released.
 */
export const releaseClaims = async (payload: Payload, ids: JobId[]): Promise<number> => {
	if (ids.length === 0) {
		return 0
	}
	// One job per call: an unlimited `updateJobs` re-reads its result with the same
	// `where`, which no longer matches once the lease is cleared, so it reports nothing.
	let released = 0
	for (const id of ids) {
		const updated = await payload.db.updateJobs({
			data: { processingToken: null, processingUntil: null, waitUntil: null },
			limit: 1,
			returning: true,
			where: {
				and: [
					{ id: { equals: id } },
					{ processingUntil: { greater_than: getCurrentDate().toISOString() } },
				],
			},
		})
		released += updated?.length ?? 0
	}
	return released
}

export { JOBS_SLUG }
