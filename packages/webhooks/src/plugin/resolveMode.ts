import type { DeliveryMode } from '../options'

/** Resolve the effective execution mode, warning when `queue` is forced with no runner. */
export const resolveMode = (args: {
	configured: DeliveryMode
	hasAutoRun: boolean
	hasJobsPlugin: boolean
	warn: (msg: string) => void
}): 'queue' | 'inline' => {
	const runnerLikely = args.hasAutoRun || args.hasJobsPlugin
	if (args.configured === 'queue') {
		if (!runnerLikely) {
			args.warn(
				'@10x-media/webhooks: delivery.mode="queue" but no job runner detected (config.jobs.autoRun unset and @10x-media/jobs not installed); queued deliveries stay pending until a worker runs.'
			)
		}
		return 'queue'
	}
	if (args.configured === 'inline') {
		return 'inline'
	}
	return runnerLikely ? 'queue' : 'inline'
}
