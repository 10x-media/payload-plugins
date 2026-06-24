import type { Config, Payload } from 'payload'
import { getCurrentDate } from 'payload'

import { getOrCreateCounter, type InFlightCounter } from '../execution/inFlight'
import { createJobLeaseStore, type JobId, type JobLeaseStore } from './jobLeaseStore'
import { initialLeaseTtlMs, isHeartbeatMode } from './leaseMode'
import type { ResolvedReliabilityOptions } from './options'

/** The slice of a handler's args the heartbeat needs. Real handlers pass a superset. */
export type HeartbeatHandlerArgs = {
	job: { id: JobId }
	req: { payload: Payload }
}

/** A job handler reduced to what the heartbeat sees. */
export type JobHandler = (args: HeartbeatHandlerArgs) => unknown

export type WithHeartbeatArgs = {
	handler: JobHandler
	options: ResolvedReliabilityOptions
	ownerId: string
	getStore: (payload: Payload) => JobLeaseStore
	/** Process-local counter incremented while the handler is executing. */
	counter?: InFlightCounter
	/** Test/diagnostic seam: invoked once if a fenced renew finds the claim was lost. */
	onLeaseLost?: (jobId: JobId) => void
}

/**
 * Wrap one job handler so the job keeps its lease fresh while it runs. On entry the
 * wrapper stamps the just-claimed row (fenced on `processing = true`) and, in
 * heartbeat mode, renews the lease on a self-scheduling timer at
 * `heartbeatIntervalMs`. A renew that matches nothing means the sweeper reclaimed the
 * job (its fence token moved): the wrapper records the loss, warns, and stops
 * renewing, but cannot abort an opaque handler (Payload exposes no AbortSignal), so
 * correctness under that race is the idempotency contract's job. The timer is always
 * cleared in `finally`. If the initial stamp fails (already completed, cancelled, or
 * reclaimed) the handler still runs, just without a heartbeat.
 */
export const withHeartbeat = (args: WithHeartbeatArgs): JobHandler => {
	const { counter, getStore, handler, onLeaseLost, options, ownerId } = args
	const ttlMs = initialLeaseTtlMs(options)
	const beats = isHeartbeatMode(options)
	const intervalMs = options.heartbeatIntervalMs

	return async (handlerArgs: HeartbeatHandlerArgs): Promise<unknown> => {
		const payload = handlerArgs.req.payload
		const jobId = handlerArgs.job.id
		const store = getStore(payload)
		const stamp = await store.stampClaim(jobId, ownerId, ttlMs, getCurrentDate())
		if (!stamp.ok) {
			return handler(handlerArgs)
		}

		// Track this job as in-flight so the drain loop knows to wait for it.
		counter?.increment()

		const fence = stamp.fenceToken
		let done = false
		let timer: ReturnType<typeof setTimeout> | undefined

		const tick = async (): Promise<void> => {
			if (done) {
				return
			}
			let ok = true
			try {
				ok = (await store.renew(jobId, fence, ttlMs, getCurrentDate())).ok
			} catch (err) {
				payload.logger?.warn(
					`@10x-media/jobs: heartbeat renew error for job ${jobId}: ${String(err)}`
				)
				schedule()
				return
			}
			if (!ok) {
				payload.logger?.warn(`@10x-media/jobs: lost lease for job ${jobId} (reclaimed)`)
				onLeaseLost?.(jobId)
				return
			}
			schedule()
		}

		function schedule(): void {
			if (done) {
				return
			}
			timer = setTimeout(() => {
				void tick()
			}, intervalMs)
		}

		if (beats) {
			schedule()
		}

		try {
			return await handler(handlerArgs)
		} finally {
			done = true
			counter?.decrement()
			if (timer) {
				clearTimeout(timer)
			}
		}
	}
}

type WrappableEntry = { handler?: unknown }

/**
 * Wrap every task and workflow handler on the config with the heartbeat. Only
 * function handlers are wrapped (Payload also allows a string path for controlled
 * handlers, which we leave alone). One job-lease store is reused per Payload instance
 * via a WeakMap. All other task and workflow properties are preserved.
 */
export const registerHeartbeat = (
	config: Config,
	options: ResolvedReliabilityOptions,
	ownerId: string
): void => {
	const jobs = config.jobs
	if (!jobs) {
		return
	}

	const storeCache = new WeakMap<Payload, JobLeaseStore>()
	const getStore = (payload: Payload): JobLeaseStore => {
		const hit = storeCache.get(payload)
		if (hit) {
			return hit
		}
		const store = createJobLeaseStore(payload)
		storeCache.set(payload, store)
		return store
	}

	// Resolve the counter now so the same counter is shared with the worker's drain loop
	// (worker reads via getOrCreateCounter(ownerId) as well).
	const counter = getOrCreateCounter(ownerId)

	const wrapEntry = <T extends WrappableEntry>(entry: T): T => {
		if (typeof entry.handler !== 'function') {
			return entry
		}
		const wrapped = withHeartbeat({
			counter,
			getStore,
			handler: entry.handler as unknown as JobHandler,
			options,
			ownerId,
		})
		return { ...entry, handler: wrapped as unknown as T['handler'] }
	}

	if (Array.isArray(jobs.tasks)) {
		jobs.tasks = jobs.tasks.map(wrapEntry) as typeof jobs.tasks
	}
	if (Array.isArray(jobs.workflows)) {
		jobs.workflows = jobs.workflows.map(wrapEntry) as typeof jobs.workflows
	}
}
