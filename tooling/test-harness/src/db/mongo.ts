import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

export interface MongoTestDb {
	adapter: ReturnType<typeof mongooseAdapter>
	stop: () => Promise<void>
	connectionString: string
}

/**
 * Boots an in-process MongoDB replica set (required for Payload transactions)
 * and returns a configured mongoose adapter pointing at a unique database.
 *
 * Caller is responsible for invoking `stop()` to terminate the server process.
 */
export const startMongo = async (): Promise<MongoTestDb> => {
	const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const replSet = await MongoMemoryReplSet.create({
		replSet: { count: 1, dbName },
	})
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
