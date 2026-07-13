import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

let replSet: MongoMemoryReplSet | undefined

// ponytail: known dbPath so stale crash remains get cleaned on next start
const dbPath = join(tmpdir(), `payload-dev-mongo-${randomUUID()}`)

/**
 * Start a throwaway in-memory MongoDB replica set for local dev when no external
 * `DATABASE_URI_MONGO` is provided, so `pnpm dev` needs no Docker or installed
 * Mongo. The dbPath is cleaned on startup so a killed/crashed prior instance
 * never leaves a stale lock file that would cause mongod to fassert on next run.
 */
export const startMemoryMongo = async (): Promise<string> => {
	// Clean stale db from previous killed/crashed process
	try { rmSync(dbPath, { recursive: true, force: true }) } catch { /* locked by sibling instance */ }

	replSet = await MongoMemoryReplSet.create({
		replSet: { count: 1 },
		instanceOpts: [{ dbPath }],
	})

	const stop = (): void => {
		void replSet?.stop()
		try { rmSync(dbPath, { recursive: true, force: true }) } catch { /* best effort */ }
		replSet = undefined
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
	process.once('exit', stop)

	return replSet.getUri()
}
