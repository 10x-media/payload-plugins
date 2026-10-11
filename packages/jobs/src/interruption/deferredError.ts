import type { Interruption } from './registry'

export const JOB_DEFERRED_ERROR_NAME = 'JobDeferredError'

/**
 * Throw from a task or workflow handler to hand the job back to the queue until
 * `until`, without spending a retry. Always defers, whatever the job's
 * interruption policy: throwing it is the author's consent to a re-run.
 */
export class JobDeferredError extends Error {
	readonly until: Date
	readonly by: string

	constructor({ until, by }: Interruption, message = `Deferred by ${by}`) {
		super(message)
		this.name = JOB_DEFERRED_ERROR_NAME
		this.until = until
		this.by = by
	}
}

/** Name check as well as the prototype, so it holds across bundled copies. */
export const isJobDeferredError = (error: unknown): error is JobDeferredError =>
	error instanceof JobDeferredError ||
	(error instanceof Error &&
		error.name === JOB_DEFERRED_ERROR_NAME &&
		(error as Partial<JobDeferredError>).until instanceof Date &&
		typeof (error as Partial<JobDeferredError>).by === 'string')
