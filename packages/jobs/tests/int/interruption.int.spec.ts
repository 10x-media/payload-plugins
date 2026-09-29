import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type Config, definePlugin, type TaskConfig, type WorkflowConfig } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'

import { resetHandlersInstalled } from '../../src/execution/signals'
import { createWorker, type WorkerTestHandle } from '../../src/execution/worker'
import {
	applyJobInterruptions,
	checkpoint,
	deferOnInterrupt,
	JobDeferredError,
	type JobsRegistry,
	jobs,
	type RunGateResult,
	resumeDeferred,
	wrapJobHandlers,
} from '../../src/index'
import { resolveReliabilityOptions } from '../../src/reliability/options'

// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

const UNTIL = new Date('2099-01-01T00:00:00.000Z')

/** The error the test classifier recognises as an interruption. */
class Blocked extends Error {
	constructor() {
		super('blocked by the test')
		this.name = 'Blocked'
	}
}

const state = {
	blocked: true,
	gate: null as RunGateResult,
	stepOneRuns: 0,
}

const throwIfBlocked = () => {
	if (state.blocked) {
		throw new Blocked()
	}
	return { output: {} }
}

const failing: TaskConfig<'failing'> = { slug: 'failing', retries: 3, handler: throwIfBlocked }
const listed: TaskConfig<'listed'> = { slug: 'listed', handler: throwIfBlocked }
const plainError: TaskConfig<'plainError'> = {
	slug: 'plainError',
	handler: () => {
		throw new Error('not an interruption')
	},
}
const checkpointed: TaskConfig<'checkpointed'> = {
	slug: 'checkpointed',
	handler: async ({ job, req }) => {
		await checkpoint({ job, req })
		return { output: {} }
	},
}
const deferredByOther: TaskConfig<'deferredByOther'> = {
	slug: 'deferredByOther',
	handler: () => {
		throw new JobDeferredError({ by: 'other', until: UNTIL })
	},
}
const stepOne: TaskConfig<'stepOne'> = {
	slug: 'stepOne',
	handler: () => {
		state.stepOneRuns += 1
		return { output: {} }
	},
}
const stepTwo: TaskConfig<'stepTwo'> = { slug: 'stepTwo', handler: throwIfBlocked }

type StepRunner = (id: string, options: { input: object }) => Promise<unknown>

const workflow = deferOnInterrupt<WorkflowConfig>({
	slug: 'twoSteps',
	handler: async ({ tasks }) => {
		const steps = tasks as unknown as Record<'stepOne' | 'stepTwo', StepRunner>
		await steps.stepOne('1', { input: {} })
		await steps.stepTwo('2', { input: {} })
	},
})

/** Ordered after jobs: its tasks and extensions arrive once jobs has run. */
const latePlugin = definePlugin<{ enabled?: boolean }>({
	slug: 'test-late',
	order: 10,
	plugin: ({ config }): Config => {
		const registry = config.custom?.['@10x-media/jobs'] as JobsRegistry
		registry.extensions.runGates.push(() => state.gate)
		registry.extensions.interruptOn.push(({ error }) =>
			error instanceof Blocked ? { by: 'test', until: UNTIL } : null
		)
		config.jobs = {
			...config.jobs,
			tasks: [
				...(config.jobs?.tasks ?? []),
				deferOnInterrupt<TaskConfig<'lateDefer'>>({ slug: 'lateDefer', handler: throwIfBlocked }),
			],
		}
		return config
	},
})

type JobRow = {
	id: number | string
	completedAt?: null | string
	deferredBy?: null | string
	error?: { interruptedBy?: string; message?: string } | null
	fenceToken?: null | number
	hasError?: boolean | null
	log?: Array<{ state?: string; taskSlug?: string }> | null
	processing?: boolean | null
	totalTried?: null | number
	waitUntil?: null | string
}

describeForDb('job interruptions', {}, (db) => {
	let booted: BootedPayload

	const read = async (id: number | string): Promise<JobRow> =>
		(await booted.payload.findByID({
			collection: 'payload-jobs',
			depth: 0,
			id,
			overrideAccess: true,
		})) as unknown as JobRow

	const runOnce = async (): Promise<void> => {
		await booted.payload.jobs.run({ allQueues: true, silent: true })
		await applyJobInterruptions(booted.payload)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ interrupt: { defer: ['listed'] }, reliability: {} }),
			db,
			configOverrides: {
				jobs: {
					deleteJobOnComplete: false,
					tasks: [failing, listed, plainError, checkpointed, deferredByOther, stepOne, stepTwo],
					workflows: [workflow],
				},
				plugins: [latePlugin({})],
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	beforeEach(() => {
		state.blocked = true
		state.gate = null
		state.stepOneRuns = 0
	})

	afterEach(async () => {
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	})

	it('fails an interrupted job for good by default, cutting off its retries', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, task: 'failing' })
		await runOnce()
		const row = await read(job.id)
		expect(row.hasError).toBe(true)
		expect(row.processing).toBe(false)
		expect(row.waitUntil ?? null).toBeNull()
		expect(row.error?.message).toBe('Interrupted by test')
		expect(row.error?.interruptedBy).toBe('test')
		expect(row.deferredBy ?? null).toBeNull()
	})

	it('defers a job that opted in, spending no retry', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, task: 'lateDefer' })
		await runOnce()
		const row = await read(job.id)
		expect(row.hasError).toBe(false)
		expect(row.processing).toBe(false)
		expect(row.totalTried).toBe(0)
		expect(row.deferredBy).toBe('test')
		expect(new Date(row.waitUntil ?? 0).toISOString()).toBe(UNTIL.toISOString())
		expect((row.log ?? []).filter((entry) => entry.state === 'failed')).toHaveLength(0)
	})

	it('defers a task named in the central list', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, task: 'listed' })
		await runOnce()
		const row = await read(job.id)
		expect(row.hasError).toBe(false)
		expect(row.deferredBy).toBe('test')
	})

	it('leaves errors no classifier recognises to Payload', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, task: 'plainError' })
		await runOnce()
		const row = await read(job.id)
		expect(row.hasError).toBe(true)
		expect(row.error?.message).toBe('not an interruption')
		expect(row.deferredBy ?? null).toBeNull()
	})

	it('checkpoint defers a job whose queue a gate pauses, whatever its policy', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, task: 'checkpointed' })
		// The gate must not stop the run itself: payload.jobs.run ignores gates.
		state.gate = { by: 'test', paused: 'all', until: UNTIL }
		await runOnce()
		const row = await read(job.id)
		expect(row.hasError).toBe(false)
		expect(row.deferredBy).toBe('test')
		expect(new Date(row.waitUntil ?? 0).toISOString()).toBe(UNTIL.toISOString())
	})

	it('checkpoint passes when no gate pauses the queue', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, task: 'checkpointed' })
		state.gate = { by: 'test', paused: ['elsewhere'], until: UNTIL }
		await runOnce()
		expect((await read(job.id)).completedAt).toBeTruthy()
	})

	it('re-runs a deferred workflow from the step it stopped at', async () => {
		const job = await booted.payload.jobs.queue({ input: {}, workflow: 'twoSteps' })
		await runOnce()
		expect((await read(job.id)).deferredBy).toBe('test')
		expect(state.stepOneRuns).toBe(1)

		state.blocked = false
		await resumeDeferred(booted.payload, 'test')
		await runOnce()
		const row = await read(job.id)
		expect(row.completedAt).toBeTruthy()
		expect(state.stepOneRuns).toBe(1)
	})

	it('resumeDeferred releases only the jobs deferred by that name', async () => {
		const ours = await booted.payload.jobs.queue({ input: {}, task: 'lateDefer' })
		const theirs = await booted.payload.jobs.queue({ input: {}, task: 'deferredByOther' })
		await runOnce()
		expect((await read(theirs.id)).deferredBy).toBe('other')

		const { resumed } = await resumeDeferred(booted.payload, 'test')
		expect(resumed).toBe(1)
		const released = await read(ours.id)
		expect(released.deferredBy ?? null).toBeNull()
		expect(released.waitUntil ?? null).toBeNull()
		const untouched = await read(theirs.id)
		expect(untouched.deferredBy).toBe('other')
		expect(untouched.waitUntil).toBeTruthy()
	})

	it('heartbeats tasks a later plugin added, and wraps each handler once', async () => {
		state.blocked = false
		const job = await booted.payload.jobs.queue({ input: {}, task: 'lateDefer' })
		await runOnce()
		const row = await read(job.id)
		expect(row.completedAt).toBeTruthy()
		expect(row.fenceToken ?? 0).toBeGreaterThan(0)

		const before = booted.payload.config.jobs.tasks
		expect(wrapJobHandlers(booted.payload)).toBe(false)
		expect(booted.payload.config.jobs.tasks).toBe(before)
	})

	it('the worker claims nothing from a queue a gate pauses', async () => {
		resetHandlersInstalled()
		state.blocked = false
		state.gate = { by: 'test', paused: 'all', until: UNTIL }
		const reliability = resolveReliabilityOptions({ leaderId: 'interrupt-node' })
		if (!reliability) {
			throw new Error('reliability options resolved to null')
		}
		const worker = createWorker({
			installSignals: false,
			payload: booted.payload,
			reliability,
			runIntervalMs: 50,
			scheduling: false,
		}) as WorkerTestHandle
		const job = await booted.payload.jobs.queue({ input: {}, task: 'lateDefer' })
		worker.start()
		try {
			await new Promise((resolve) => setTimeout(resolve, 300))
			await worker.settle()
			expect((await read(job.id)).totalTried ?? 0).toBe(0)

			state.gate = null
			await expect
				.poll(async () => Boolean((await read(job.id)).completedAt), { timeout: 5000 })
				.toBe(true)
		} finally {
			await worker.stop()
		}
	})
})
