import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

export interface MongoTestDb {
	adapter: ReturnType<typeof mongooseAdapter>
	stop: () => Promise<void>
	connectionString: string
}

// ponytail: known dbPath so stale crash remains get cleaned on next start
const dbPath = join(tmpdir(), `payload-test-mongo-${randomUUID()}`)

export const startMongo = async (): Promise<MongoTestDb> => {
	try { rmSync(dbPath, { recursive: true, force: true }) } catch { /* locked by sibling */ }

	const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const replSet = await MongoMemoryReplSet.create({
		replSet: { count: 1, dbName },
		instanceOpts: [{ dbPath }],
	})
	const uri = replSet.getUri(dbName)
	const adapter = mongooseAdapter({ ensureIndexes: true, url: uri })

	return {
		adapter,
		connectionString: uri,
		stop: async () => {
			await replSet.stop()
			try { rmSync(dbPath, { recursive: true, force: true }) } catch { /* best effort */ }
		},
	}
}
