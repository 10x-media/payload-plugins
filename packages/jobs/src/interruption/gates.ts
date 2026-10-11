import { getCurrentDate, type Payload, type PayloadRequest } from 'payload'

import type { PauseState } from '../queueControl/pauseState'
import { JobDeferredError } from './deferredError'
import { jobsRegistryOf, type RunGateResult } from './registry'

/** The merged verdict of every run gate for one tick. */
export type GatePause = PauseState & {
	/** Latest known end over the pausing gates; `null` when any of them does not know. */
	until: Date | null
	/** Who paused, when a gate said. */
	by: string | null
}

const OPEN: GatePause = { by: null, global: false, queues: [], until: null }

/** When nobody knows how long a pause lasts, a checkpoint defers this long. */
export const UNKNOWN_PAUSE_MS = 5 * 60 * 1000

/** Merge gate verdicts. A gate that threw is passed as `'error'` and pauses everything. */
export const mergeGateResults = (results: ReadonlyArray<RunGateResult | 'error'>): GatePause => {
	let merged: GatePause = OPEN
	let unknownEnd = false
	for (const result of results) {
		if (result === null) {
			continue
		}
		if (result === 'error') {
			merged = { ...merged, global: true }
			unknownEnd = true
			continue
		}
		const queues =
			result.paused === 'all'
				? merged.queues
				: [...merged.queues, ...result.paused.filter((queue) => !merged.queues.includes(queue))]
		const until = result.until ?? null
		if (until === null) {
			unknownEnd = true
		}
		merged = {
			by: merged.by ?? result.by ?? null,
			global: merged.global || result.paused === 'all',
			queues,
			until: until && (!merged.until || until > merged.until) ? until : merged.until,
		}
	}
	return unknownEnd ? { ...merged, until: null } : merged
}

/** Evaluate every registered run gate once. */
export const evaluateRunGates = async (payload: Payload): Promise<GatePause> => {
	const gates = jobsRegistryOf(payload.config)?.extensions.runGates ?? []
	if (gates.length === 0) {
		return OPEN
	}
	const results = await Promise.all(
		gates.map(async (gate): Promise<RunGateResult | 'error'> => {
			try {
				return await gate({ payload })
			} catch (err) {
				payload.logger.error(
					`@10x-media/jobs: run gate failed, pausing all queues for this tick: ${String(err)}`
				)
				return 'error'
			}
		})
	)
	return mergeGateResults(results)
}

/** The manual pause widened by the gates. */
export const withGates = (manual: PauseState, gates: GatePause): PauseState => ({
	global: manual.global || gates.global,
	queues: [...manual.queues, ...gates.queues.filter((queue) => !manual.queues.includes(queue))],
})

/**
 * For long handlers to call between batches: when a run gate pauses the job's
 * queue, throws `JobDeferredError` so the job goes back to the queue until the
 * pause is expected to end. It defers whatever the job's interruption policy,
 * so place it only where stopping and re-running later is safe.
 */
export const checkpoint = async (args: {
	req: Pick<PayloadRequest, 'payload'>
	job: { queue?: null | string }
}): Promise<void> => {
	const gates = await evaluateRunGates(args.req.payload)
	const queue = args.job.queue ?? 'default'
	if (!gates.global && !gates.queues.includes(queue)) {
		return
	}
	const until = gates.until ?? new Date(getCurrentDate().getTime() + UNKNOWN_PAUSE_MS)
	throw new JobDeferredError({ by: gates.by ?? 'checkpoint', until })
}
