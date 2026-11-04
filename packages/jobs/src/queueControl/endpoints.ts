import type { Endpoint, PayloadRequest } from 'payload'

import { evaluateRunGates, withGates } from '../interruption/gates'
import { applyJobInterruptions } from '../interruption/records'
import { wrapJobHandlers } from '../interruption/wrap'
import type { ResolvedReliabilityOptions } from '../reliability/options'
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
		if (limit !== undefined && !Number.isFinite(limit)) {
			return Response.json({ message: 'Invalid limit parameter' }, { status: 400 })
		}
		const silent = query.silent === 'true'
		wrapJobHandlers(req.payload)
		const state = withGates(
			await createPauseStore(req.payload).getState(),
			await evaluateRunGates(req.payload)
		)
		// Mirror the native run scope: `allQueues` runs every queue, otherwise a single
		// queue (defaulting to `default`, as the native endpoint does). Pause, widened by
		// the run gates, is honored either way via runTargetsForPause.
		const requested = query.allQueues === 'true' ? undefined : [query.queue ?? 'default']
		const targets = runTargetsForPause(requested, state)

		if (query.disableScheduling !== 'true') {
			await req.payload.jobs.handleSchedules({ allQueues: true })
		}
		const results = []
		for (const target of targets) {
			results.push(
				// `deps.access` above already decided; Payload's own run gate is the same check.
				await req.payload.jobs.run({
					...target,
					overrideAccess: true,
					...(limit !== undefined ? { limit } : {}),
					silent,
				})
			)
			await applyJobInterruptions(req.payload)
		}
		return Response.json({ paused: state, ran: targets.length, results }, { status: 200 })
	},
	method: 'get',
	path: '/queue-run',
})
