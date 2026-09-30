import {
	checkpoint,
	createWorker,
	deferOnInterrupt,
	resolveReliabilityOptions,
} from '@10x-media/jobs'
import type { CollectionSlug, Payload, PayloadRequest, TaskConfig } from 'payload'

import { sampleData } from '../app/(frontend)/playground/sample'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type WriteArgs = { input: { slug: string }; req: PayloadRequest }

const writeOnce = async ({ input, req }: WriteArgs) => {
	await req.payload.create({
		collection: input.slug as CollectionSlug,
		data: sampleData('collection', input.slug),
		req,
	})
	return { output: {} }
}

/** Playground tasks: one write that fails when interrupted, one that defers, one slow batch. */
const inputSchema: TaskConfig['inputSchema'] = [{ name: 'slug', type: 'text', required: true }]

/** Waits 5s before writing, so a lock can start while the job runs. */
const slowWrite = async (args: WriteArgs) => {
	await sleep(5000)
	return writeOnce(args)
}

export const playgroundTasks: TaskConfig[] = [
	{ slug: 'playgroundWrite', inputSchema, retries: 2, handler: slowWrite },
	deferOnInterrupt({ slug: 'playgroundWriteDeferred', inputSchema, handler: slowWrite }),
	{
		slug: 'playgroundBatch',
		inputSchema,
		handler: async ({ input, job, req }: WriteArgs & { job: { queue?: null | string } }) => {
			for (let batch = 0; batch < 10; batch += 1) {
				await checkpoint({ job, req })
				await writeOnce({ input, req })
				await sleep(3000)
			}
			return { output: {} }
		},
	},
] as TaskConfig[]

const WORKER_KEY = Symbol.for('content-lock-dev:worker')

/** One worker per dev process, so queued playground jobs run and honour the lock. */
export const startDevWorker = (payload: Payload): void => {
	const holder = globalThis as { [WORKER_KEY]?: boolean }
	if (holder[WORKER_KEY]) {
		return
	}
	const reliability = resolveReliabilityOptions(true)
	if (!reliability) {
		return
	}
	holder[WORKER_KEY] = true
	createWorker({
		installSignals: false,
		payload,
		reliability,
		runIntervalMs: 2000,
		scheduling: false,
	}).start()
}
