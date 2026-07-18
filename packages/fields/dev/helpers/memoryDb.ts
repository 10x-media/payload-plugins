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
 * Payload's own suite run Mongo, so transactions behave the same as in prod.
 * Idempotent per process: reloads reuse the one running mongod.
 */
export const startMemoryMongo = async (): Promise<string> => {
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
