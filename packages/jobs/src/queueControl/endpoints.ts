import type { Endpoint, PayloadRequest } from 'payload'

import { createJobLeaseStore } from '../reliability/jobLeaseStore'
import type { ResolvedReliabilityOptions } from '../reliability/options'
import { runSweep } from '../reliability/sweeper'
import type { JobAccess } from './access'
import { createPauseStore } from './pauseStore'
import { getQueueHealth } from './queueHealth'
import { runTargetsForPause } from './runTargets'

export type QueueEndpointDeps = {
	access: JobAccess
	queues: string[]
	reliability: ResolvedReliabilityOptions | null
}

const unauthorized = (): Response => Response.json({ message: 'Unauthorized' }, { status: 401 })

/** GET queue health, grouped by queue. */
export const statusEndpoint = (deps: QueueEndpointDeps): Endpoint => ({
	handler: async (req: PayloadRequest) => {
		if (!(await deps.access({ req }))) {
			return unauthorized()
		}
		const report = await getQueueHealth(req.payload, {
			includeRecovered: deps.reliability !== null,
			queues: deps.queues,
		})
		return Response.json(report, { status: 200 })
	},
	method: 'get',
	path: '/queue-status',
})

/**
 * GET a hardened, pause-aware run. Mirrors the native run params.
 *
 * Security note: this is a state-mutating GET. A logged-in browser session can be
 * exploited via CSRF (crafted img/link). For deployments where browser sessions are
 * involved, set `access` to `cronSecretAccess` rather than the default `loggedInAccess`.
 */
export const runControlEndpoint = (deps: QueueEndpointDeps): Endpoint => ({
	handler: async (req: PayloadRequest) => {
		if (!(await deps.access({ req }))) {
			return unauthorized()
		}
		const query = req.query as {
			allQueues?: string
			disableScheduling?: string
			limit?: string
			queue?: string
			silent?: string
		}
		const limit = query.limit ? Number(query.limit) : undefined
		const silent = query.silent === 'true'
		const state = await createPauseStore(req.payload).getState()
		// Mirror the native run scope: `allQueues` runs every queue, otherwise a single
		// queue (defaulting to `default`, as the native endpoint does). Pause is honored
		// either way via runTargetsForPause.
		const requested = query.allQueues === 'true' ? undefined : [query.queue ?? 'default']
		const targets = runTargetsForPause(requested, state)

		if (query.disableScheduling !== 'true') {
			await req.payload.jobs.handleSchedules({ allQueues: true })
		}
		const results = []
		for (const target of targets) {
			results.push(
				await req.payload.jobs.run({
					...target,
					...(limit !== undefined ? { limit } : {}),
					silent,
				})
			)
		}
		return Response.json({ paused: state, ran: targets.length, results }, { status: 200 })
	},
	method: 'get',
	path: '/queue-run',
})

/**
 * GET a one-shot sweep for serverless (one cron invocation, so no leader election).
 *
 * Security note: same CSRF exposure as `runControlEndpoint`; override `access` with
 * `cronSecretAccess` for cookie-session deployments.
 */
export const sweepEndpoint = (deps: QueueEndpointDeps): Endpoint => ({
	handler: async (req: PayloadRequest) => {
		if (!(await deps.access({ req }))) {
			return unauthorized()
		}
		if (!deps.reliability) {
			return Response.json(
				{ message: 'reliability is not enabled; the sweeper is unavailable' },
				{ status: 400 }
			)
		}
		const result = await runSweep({
			isLeader: true,
			options: deps.reliability,
			payload: req.payload,
			store: createJobLeaseStore(req.payload),
		})
		return Response.json(result, { status: 200 })
	},
	method: 'get',
	path: '/queue-sweep',
})
