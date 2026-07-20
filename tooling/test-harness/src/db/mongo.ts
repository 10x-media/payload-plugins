import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

export interface MongoTestDb {
	adapter: ReturnType<typeof mongooseAdapter>
	stop: () => Promise<void>
	connectionString: string
}

/**
 * `mongodb-memory-server` auto-picks a free port, but the check-then-bind has a race: when many
 * boots start at once (parallel test files, or a single file booting more than one instance) two
 * mongods can pick the same port and creation rejects with `Port "<n>" already in use`. A retry
 * re-picks a fresh port, so the flake never surfaces to the suite. Any other error is rethrown at once.
 */
const PORT_IN_USE = /already in use/i
const MAX_START_ATTEMPTS = 5

const createReplSet = async (dbName: string): Promise<MongoMemoryReplSet> => {
	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
		try {
			return await MongoMemoryReplSet.create({ replSet: { count: 1, dbName } })
		} catch (error) {
			lastError = error
			if (!(error instanceof Error) || !PORT_IN_USE.test(error.message)) {
				throw error
			}
		}
	}
	throw lastError
}

/**
 * Boots an in-process MongoDB replica set (required for Payload transactions)
 * and returns a configured mongoose adapter pointing at a unique database.
 *
 * Caller is responsible for invoking `stop()` to terminate the server process.
 */
export const startMongo = async (): Promise<MongoTestDb> => {
	const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const replSet = await createReplSet(dbName)
	const uri = replSet.getUri(dbName)
	const adapter = mongooseAdapter({ ensureIndexes: true, url: uri })

	return {
		adapter,
		connectionString: uri,
		stop: async () => {
			await replSet.stop()
		},
	}
}
