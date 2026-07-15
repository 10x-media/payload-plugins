import { MongoMemoryReplSet } from 'mongodb-memory-server'

let replSet: MongoMemoryReplSet | undefined

/**
 * Start a throwaway in-memory MongoDB replica set for local dev when no external
 * `DATABASE_URI_MONGO` is provided, so `pnpm dev` needs no Docker or installed
 * Mongo. A replica set (not a standalone) matches how the test harness and
 * Payload's own suite run Mongo, so transactions behave the same as in prod. The
 * server is stopped when the Node process exits.
 */
export const startMemoryMongo = async (): Promise<string> => {
	replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })

	const stop = (): void => {
		void replSet?.stop()
		replSet = undefined
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
	process.once('exit', stop)

	return replSet.getUri()
}
