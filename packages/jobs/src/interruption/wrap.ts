import type { Payload } from 'payload'

import { createHeartbeatLayer, type HeartbeatPlan, type JobHandler } from '../reliability/heartbeat'
import { isJobDeferredError } from './deferredError'
import { type DeferSlugs, policyFor, resolveDeferSlugs } from './policy'
import { hasInterruption, type InterruptionRecord, recordInterruption } from './records'
import { jobsRegistryOf } from './registry'

/** What `wrapJobHandlers` applies, resolved at config time. */
export type WrapPlan = {
	/** Task and workflow slugs that defer on interrupt (`jobs({ interrupt: { defer } })`). */
	defer: string[]
	heartbeat: HeartbeatPlan | null
}

type ClaimedJob = {
	id: number | string
	queue?: null | string
	taskSlug?: null | string
	workflowSlug?: null | string
	totalTried?: null | number
	log?: Array<{ id?: null | string } | null> | null
}

type InlineTaskOptions = { task?: unknown } & Record<string, unknown>
type InlineTask = (taskID: string, options: InlineTaskOptions) => unknown

type HandlerArgs = {
	job: ClaimedJob
	req: { payload: Payload }
	inlineTask?: InlineTask
}

type Handler = (args: HandlerArgs) => unknown
type Claim = Pick<InterruptionRecord, 'logIds' | 'totalTried'>

const WRAPPED = Symbol.for('@10x-media/jobs:wrapped')
const wrappedConfigs = new WeakSet<object>()

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

type Classified = { until: Date; by: string; forced: boolean }

const classify = (payload: Payload, error: unknown): Classified | null => {
	if (isJobDeferredError(error)) {
		return { by: error.by, forced: true, until: error.until }
	}
	for (const classifier of jobsRegistryOf(payload.config)?.extensions.interruptOn ?? []) {
		try {
			const found = classifier({ error, payload })
			if (found) {
				return { ...found, forced: false }
			}
		} catch (err) {
			payload.logger.error(`@10x-media/jobs: interrupt classifier failed: ${String(err)}`)
		}
	}
	return null
}

type NoteArgs = {
	payload: Payload
	job: ClaimedJob
	claim: Claim
	error: unknown
	defer: DeferSlugs
}

const noteInterruption = ({ payload, job, claim, error, defer }: NoteArgs): void => {
	if (hasInterruption(payload, job.id)) {
		return
	}
	const found = classify(payload, error)
	if (!found) {
		return
	}
	recordInterruption(payload, job.id, {
		...claim,
		by: found.by,
		outcome: found.forced ? 'defer' : policyFor(job, defer),
		reason: messageOf(error),
		recordedAt: Date.now(),
		until: found.until,
	})
}

/** Run inline tasks through the same classification, before Payload wraps their errors. */
const guardInlineTask =
	(inlineTask: InlineTask, note: (error: unknown) => void): InlineTask =>
	(taskID, options) => {
		const task = options.task
		if (typeof task !== 'function') {
			return inlineTask(taskID, options)
		}
		return inlineTask(taskID, {
			...options,
			task: async (...args: unknown[]) => {
				try {
					return await task(...args)
				} catch (error) {
					note(error)
					throw error
				}
			},
		})
	}

/**
 * Record an interruption the handler throws, then rethrow so Payload handles
 * the error as usual; `applyJobInterruptions` rewrites the row afterwards.
 */
const withInterruption =
	(handler: Handler, defer: DeferSlugs): Handler =>
	async (args) => {
		const { job, req } = args
		const claim: Claim = {
			logIds: (job.log ?? []).flatMap((entry) => (entry?.id ? [String(entry.id)] : [])),
			totalTried: job.totalTried ?? 0,
		}
		const note = (error: unknown) =>
			noteInterruption({ claim, defer, error, job, payload: req.payload })
		const guarded = args.inlineTask
			? { ...args, inlineTask: guardInlineTask(args.inlineTask, note) }
			: args
		try {
			return await handler(guarded)
		} catch (error) {
			note(error)
			throw error
		}
	}

/**
 * Wrap every function handler in `payload.config.jobs` with the interruption
 * wrapper and, when reliability is on, the heartbeat around it. Runs in the
 * plugin's `onInit`, after every plugin has added its tasks; Payload reads
 * handlers from `payload.config.jobs` at run time, so every run path sees the
 * wrapped ones. Idempotent per jobs config: the worker and `queue-run` call it
 * before each run to cover a config swapped by an HMR reload. Handlers
 * registered by path are left alone. Returns whether it wrapped anything.
 */
export const wrapJobHandlers = (payload: Payload): boolean => {
	const registry = jobsRegistryOf(payload.config)
	const jobs = payload.config.jobs
	if (!registry || !jobs || wrappedConfigs.has(jobs)) {
		return false
	}
	wrappedConfigs.add(jobs)
	const tasks = Array.isArray(jobs.tasks) ? jobs.tasks : []
	const workflows = Array.isArray(jobs.workflows) ? jobs.workflows : []
	const defer = resolveDeferSlugs(tasks, workflows, registry.plan.defer)
	const heartbeat = registry.plan.heartbeat
		? createHeartbeatLayer(registry.plan.heartbeat, workflows)
		: null

	const wrap = <T extends { handler?: unknown }>(entry: T, kind: 'task' | 'workflow'): T => {
		const handler = entry.handler
		if (typeof handler !== 'function' || (handler as { [WRAPPED]?: true })[WRAPPED]) {
			return entry
		}
		let next = withInterruption(handler as Handler, defer)
		if (heartbeat) {
			next = heartbeat(next as unknown as JobHandler, kind) as unknown as Handler
		}
		Object.defineProperty(next, WRAPPED, { value: true })
		return { ...entry, handler: next }
	}

	if (Array.isArray(jobs.tasks)) {
		jobs.tasks = tasks.map((task) => wrap(task, 'task'))
	}
	if (Array.isArray(jobs.workflows)) {
		jobs.workflows = workflows.map((workflow) => wrap(workflow, 'workflow'))
	}
	return true
}
