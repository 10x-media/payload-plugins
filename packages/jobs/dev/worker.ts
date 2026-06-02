// biome-ignore-all lint/plugin/noProcessEnv: worker entrypoint env boundary
import { getPayload } from 'payload'

import { createWorker, resolveReliabilityOptions } from '../src/index'
import { RELIABILITY_OPTIONS } from './jobsOptions'
import config from './payload.config'

/**
 * A standalone worker process: boots Payload, starts the plugin-driven worker (run on
 * every node, schedule and sweep only while holding the lease), and lets `createWorker`
 * install the SIGTERM/SIGINT graceful-drain handlers. This is the documented production
 * worker pattern and the process the drain e2e spawns.
 */
const main = async (): Promise<void> => {
	const payload = await getPayload({ config })
	const reliability = resolveReliabilityOptions(RELIABILITY_OPTIONS)
	if (!reliability) {
		throw new Error('@10x-media/jobs worker: reliability resolved to null')
	}
	createWorker({
		payload,
		reliability,
		drainTimeoutMs: Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 30_000),
		runIntervalMs: Number(process.env.WORKER_RUN_INTERVAL_MS ?? 2_000),
	}).start()
	payload.logger.info('@10x-media/jobs worker started; awaiting jobs and signals')
}

main().catch((err) => {
	console.error('@10x-media/jobs worker failed to start', err)
	process.exit(1)
})
