// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * The running replica set is cached on `globalThis` so it survives module
 * re-evaluation. Next dev HMR and `payload.reload()` re-run `startMemoryMongo`
 * on every cycle; a module-scoped variable would be reset and each call would
 * spawn a fresh mongod while orphaning the previous one (a multi-GB leak over a
 * day of editing). The promise is cached so concurrent boot-time callers share
 * one instance.
 */
const globalForMongo = globalThis as typeof globalThis & {
	__10xMediaDevMemoryMongo?: Promise<MongoMemoryReplSet>
}

/**
 * Start a throwaway in-memory MongoDB replica set for local dev when no external
 * `DATABASE_URI_MONGO` is provided, so `pnpm dev` needs no Docker or installed
 * Mongo. A replica set (not a standalone) matches how the test harness and
 * Payload's own suite run Mongo, so transactions behave the same as in prod. The
 * server is stopped when the Node process exits. Idempotent per process: reloads
 * reuse the one running mongod.
 */
export const startMemoryMongo = async (): Promise<string> => {
	// `next build` imports the config to collect page data but never opens a
	// connection, so skip the real replica set during a production build. Several
	// dev-app builds run concurrently under `turbo run test:dist` and would
	// otherwise race on the shared mongodb-memory-server binary lock.
	if (process.env.NEXT_PHASE === 'phase-production-build') {
		return 'mongodb://127.0.0.1:27017/payload-build-placeholder'
	}
	if (!globalForMongo.__10xMediaDevMemoryMongo) {
		globalForMongo.__10xMediaDevMemoryMongo = MongoMemoryReplSet.create({ replSet: { count: 1 } })

		const stop = (): void => {
			const pending = globalForMongo.__10xMediaDevMemoryMongo
			globalForMongo.__10xMediaDevMemoryMongo = undefined
			void pending?.then((replSet) => replSet.stop())
		}
		process.once('SIGINT', stop)
		process.once('SIGTERM', stop)
		process.once('exit', stop)
	}

	return (await globalForMongo.__10xMediaDevMemoryMongo).getUri()
}
