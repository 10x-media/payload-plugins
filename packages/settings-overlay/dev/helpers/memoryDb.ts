// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * Cached on `globalThis` so it survives module re-evaluation: Next dev HMR and
 * `payload.reload()` re-run `startMemoryMongo` every cycle, and a module-scoped variable
 * would spawn a fresh mongod each time while orphaning the previous one (a multi-GB leak
 * over a day of editing). The promise is cached so concurrent callers share one instance.
 */
const globalForMongo = globalThis as typeof globalThis & {
	__10xMediaDevMemoryMongo?: Promise<MongoMemoryReplSet>
}

/**
 * Start a throwaway in-memory MongoDB replica set for local dev when no external
 * `DATABASE_URI_MONGO` is provided, so `pnpm dev` needs no Docker or installed Mongo. A
 * replica set (not a standalone) matches how the test harness and Payload's own suite run
 * Mongo, so transactions behave the same as in prod. Stopped on SIGINT/SIGTERM, and
 * idempotent per process: reloads reuse the one running mongod.
 */
export const startMemoryMongo = async (): Promise<string> => {
	// `next build` imports the config to collect page data but never connects; booting a
	// replica set per concurrent dev-app build exhausts the CI runner.
	if (process.env.NEXT_PHASE === 'phase-production-build') {
		return 'mongodb://127.0.0.1:27017/payload-build-placeholder'
	}

	if (!globalForMongo.__10xMediaDevMemoryMongo) {
		globalForMongo.__10xMediaDevMemoryMongo = MongoMemoryReplSet.create({ replSet: { count: 1 } })

		/**
		 * Signals only: an `exit` listener cannot await, so stopping from there never gets past
		 * the first tick and leaves a mongod behind. Re-raise after the stop to exit properly.
		 */
		const stop = async (signal: NodeJS.Signals): Promise<void> => {
			const pending = globalForMongo.__10xMediaDevMemoryMongo
			globalForMongo.__10xMediaDevMemoryMongo = undefined
			await pending?.then((replSet) => replSet.stop())
			process.kill(process.pid, signal)
		}

		process.once('SIGINT', () => void stop('SIGINT'))
		process.once('SIGTERM', () => void stop('SIGTERM'))
	}

	return (await globalForMongo.__10xMediaDevMemoryMongo).getUri()
}
