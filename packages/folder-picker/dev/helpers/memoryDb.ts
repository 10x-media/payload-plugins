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
	if (!globalForMongo.__10xMediaDevMemoryMongo) {
		globalForMongo.__10xMediaDevMemoryMongo = MongoMemoryReplSet.create({ replSet: { count: 1 } })

		/**
		 * Signals only. An `exit` listener cannot await anything, so stopping the replica set from
		 * there never gets past the first tick and leaves a mongod behind; handling the signal and
		 * re-raising it after the stop is the only way to shut down cleanly.
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
