import type { Payload } from 'payload'
import { getCurrentDate } from 'payload'
import { createPauseStore, type PauseStore } from '../queueControl/pauseStore'
import { runTargetsForPause } from '../queueControl/runTargets'
import { createJobLeaseStore } from '../reliability/jobLeaseStore'
import { createLeaderController } from '../reliability/leaderController'
import { createLeaseStore } from '../reliability/leaseStore'
import type { LeaderRole } from '../reliability/locksCollection'
import { resolveNodeId } from '../reliability/nodeId'
import type { ResolvedReliabilityOptions } from '../reliability/options'
import { runSweep } from '../reliability/sweeper'
import { type DrainResult, drainWorker } from './drain'
import { getOrCreateCounter, releaseCounter } from './inFlight'
import { areHandlersInstalled, installSignalHandlers, type SignalCleanup } from './signals'
import { maintenanceCycle, runCycle, sweepCycle } from './workerCycles'

export type CreateWorkerArgs = {
	payload: Payload
	reliability: ResolvedReliabilityOptions
	/** Queues to run. Omit (or empty) to run all queues. */
	queues?: string[]
	/** When provided, the run loop honors cluster-wide pause/resume. */
	pauseStore?: PauseStore
	/** How often this node claims and runs jobs. Default 2000. */
	runIntervalMs?: number
	/** How often leadership is advanced and scheduling runs (leader only). Default leaderLeaseTtlMs / 3. */
	maintenanceIntervalMs?: number
	/** Max jobs per run tick. Default 10. */
	runLimit?: number
	/** Wall-clock budget to await in-flight jobs on drain. Default 30000. */
	drainTimeoutMs?: number
	/** How often the drain re-counts in-flight jobs. Default 500. */
	pollIntervalMs?: number
	/** Register SIGTERM/SIGINT handlers that drain then exit. Default true. */
	installSignals?: boolean
	/** Which signals to drain on. Default ['SIGTERM', 'SIGINT']. */
	signals?: NodeJS.Signals[]
	/** Injectable for tests: destroy (default payload.destroy), exit, wall clock. */
	destroy?: () => Promise<void>
	exit?: (code: number) => void
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

export type Worker = {
	/** Start the run, maintenance, and sweep loops. */
	start: () => void
	/**
	 * Gracefully drain and shut down (removes signal handlers, stops loops, requeues,
	 * releases, destroys). Idempotent: repeated calls return the same in-flight drain.
	 */
	drain: () => Promise<DrainResult>
	/** Whether this node currently holds the given leadership role. */
	isLeader: (role: LeaderRole) => boolean
}

/**
 * A test-only handle for accessing `stop()`, which clears timers and signal handlers
 * without releasing leadership leases. Do not use in production; drain() is the correct
 * shutdown path. Cast a `Worker` to this type in tests to call stop().
 */
export type WorkerTestHandle = Worker & {
	stop: () => void
}

const realSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms)
	})

/** A self-skipping interval: a slow tick never overlaps the next (like Croner's `protect`). */
const guardedInterval = (fn: () => Promise<void>, ms: number): ReturnType<typeof setInterval> => {
	let busy = false
	return setInterval(() => {
		if (busy) {
			return
		}
		busy = true
		void fn().finally(() => {
			busy = false
		})
	}, ms)
}

/**
 * A plugin-driven worker: runs jobs on every node, schedules and sweeps only while
 * holding the corresponding leadership lease, and drains gracefully on SIGTERM/SIGINT.
 * It owns its own timers (never Payload's autoRun cron), because Payload's
 * `shouldAutoRun` gate permanently stops a cron and cannot follow dynamic leadership.
 * Leadership timestamps use Payload's swappable `getCurrentDate()`; the drain budget
 * uses the injected wall clock.
 */
export const createWorker = (args: CreateWorkerArgs): Worker => {
	const { payload, reliability } = args
	if (!payload.collections['payload-jobs']) {
		throw new Error(
			'@10x-media/jobs: createWorker requires at least one configured job task. Payload only registers the payload-jobs collection when jobs.tasks or jobs.workflows is non-empty.'
		)
	}
	const nodeId = resolveNodeId(reliability.leaderId)
	const leaseStore = createLeaseStore(payload)
	const jobLeaseStore = createJobLeaseStore(payload)
	const scheduler = createLeaderController({
		ownerId: nodeId,
		role: 'scheduler',
		store: leaseStore,
		ttlMs: reliability.leaderLeaseTtlMs,
	})
	const sweeper = createLeaderController({
		ownerId: nodeId,
		role: 'sweeper',
		store: leaseStore,
		ttlMs: reliability.leaderLeaseTtlMs,
	})

	const runIntervalMs = args.runIntervalMs ?? 2000
	const maintenanceIntervalMs =
		args.maintenanceIntervalMs ?? Math.max(1000, Math.floor(reliability.leaderLeaseTtlMs / 3))
	const sweepIntervalMs = reliability.sweepIntervalMs
	const runLimit = args.runLimit ?? 10
	const drainTimeoutMs = args.drainTimeoutMs ?? 30_000
	const pollIntervalMs = args.pollIntervalMs ?? 500
	const destroy =
		args.destroy ??
		(async () => {
			releaseCounter(nodeId)
			return payload.destroy()
		})
	const now = args.now ?? (() => Date.now())
	const sleep = args.sleep ?? realSleep
	const logger = payload.logger

	let timers: ReturnType<typeof setInterval>[] = []
	let signalCleanup: SignalCleanup | undefined
	let draining: Promise<DrainResult> | undefined

	// Default to a KV-backed PauseStore so presets that enable queueControl automatically
	// get the correct pause behavior without requiring an explicit pauseStore argument.
	const pauseStore: PauseStore = args.pauseStore ?? createPauseStore(payload)

	const runJobs = async (): Promise<void> => {
		const state = await pauseStore.getState()
		for (const target of runTargetsForPause(args.queues, state)) {
			await payload.jobs.run({ ...target, limit: runLimit, silent: true })
		}
	}
	const handleSchedules = async (): Promise<void> => {
		await payload.jobs.handleSchedules({ allQueues: true })
	}
	const sweep = async (): Promise<void> => {
		await runSweep({
			isLeader: sweeper.isLeader(),
			now: getCurrentDate(),
			options: reliability,
			payload,
			store: jobLeaseStore,
		})
	}
	const tickLeaders = async (at: Date): Promise<void> => {
		await scheduler.tick(at)
		await sweeper.tick(at)
	}

	const stopLoops = (): void => {
		for (const timer of timers) {
			clearInterval(timer)
		}
		timers = []
	}
	const removeSignals = (): void => {
		signalCleanup?.()
		signalCleanup = undefined
	}

	// Idempotent: a repeat call (or a second signal) returns the in-flight drain rather
	// than running the shutdown sequence twice.
	const drain = (): Promise<DrainResult> => {
		if (draining) {
			return draining
		}
		removeSignals()
		const counter = getOrCreateCounter(nodeId)
		draining = drainWorker(
			{
				countInFlight: () => Promise.resolve(counter.count()),
				destroy,
				logger,
				now,
				releaseLeadership: async () => {
					await scheduler.release()
					await sweeper.release()
				},
				requeueStragglers: async () => (await jobLeaseStore.releaseAllClaims(nodeId)).released,
				sleep,
				stopLoops,
			},
			{ drainTimeoutMs, pollIntervalMs }
		)
		return draining
	}

	const stopWorker = (): void => {
		stopLoops()
		removeSignals()
	}

	const worker: Worker = {
		drain,
		isLeader: (role) => (role === 'scheduler' ? scheduler.isLeader() : sweeper.isLeader()),
		start: () => {
			if (draining) {
				return
			}
			stopLoops()
			timers = [
				guardedInterval(() => runCycle({ logger, runJobs }), runIntervalMs),
				guardedInterval(
					() =>
						maintenanceCycle({
							handleSchedules,
							isSchedulerLeader: scheduler.isLeader,
							logger,
							now: getCurrentDate,
							tickLeaders,
						}),
					maintenanceIntervalMs
				),
				guardedInterval(
					() =>
						sweepCycle({
							isSweeperLeader: sweeper.isLeader,
							logger,
							sweep,
							tickSweeperLeader: () => sweeper.tick(getCurrentDate()),
						}),
					sweepIntervalMs
				),
			]
		},
	}

	// Attach stop() as a non-enumerable property so tests can access it via WorkerTestHandle
	// without it appearing on the public Worker type.
	Object.defineProperty(worker, 'stop', { value: stopWorker, enumerable: false })

	if (args.installSignals !== false) {
		if (areHandlersInstalled()) {
			throw new Error(
				'@10x-media/jobs: signal handlers are already installed in this process. ' +
					'Only one worker with installSignals:true may exist per process. ' +
					'Create subsequent workers with installSignals:false.'
			)
		}
		const exit = args.exit ?? ((code: number) => process.exit(code))
		signalCleanup = installSignalHandlers(args.signals ?? ['SIGTERM', 'SIGINT'], () => {
			void drain()
				.then(() => exit(0))
				.catch(() => exit(1))
		})
	}

	return worker
}
