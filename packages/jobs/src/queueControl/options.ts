import { type JobAccess, loggedInAccess } from './access'

export type QueueControlOptions = {
	/** Gate the queue-control endpoints (and the native run endpoint). Default: logged-in users only. */
	access?: JobAccess
	/** Queues to report per-queue health for. Default ['default']. */
	queues?: string[]
}

export type ResolvedQueueControlOptions = {
	access: JobAccess
	queues: string[]
}

/** Resolve queue-control options to a fully-defaulted object, or `null` when disabled. */
export const resolveQueueControlOptions = (
	options: QueueControlOptions | boolean | undefined
): ResolvedQueueControlOptions | null => {
	if (options === undefined || options === false) {
		return null
	}
	// `true` enables it with defaults; an object customizes it.
	const opts: QueueControlOptions = options === true ? {} : options
	return {
		access: opts.access ?? loggedInAccess,
		queues: opts.queues ?? ['default'],
	}
}
