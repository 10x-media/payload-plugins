// biome-ignore-all lint/plugin/noProcessEnv: test harness env boundary (TEST_DB)
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type Config, getPayload, type Payload, type Plugin } from 'payload'
import { type MongoTestDb, startMongo } from './db/mongo'
import { type MongoContainerDb, startMongoContainer } from './db/mongo-container'
import { type PostgresContainerDb, startPostgresContainer } from './db/postgres-container'

export type SupportedDb = 'mongo' | 'postgres'

/**
 * Mongo can run in-memory (default) or in a real container.
 * Postgres always runs in a real container (matches Payload's own test pattern;
 * no in-process Postgres support).
 */
export type TestDbMode = 'memory' | 'container'

export interface BootPayloadOptions {
	plugin: Plugin
	db: SupportedDb
	/**
	 * Mongo only. When omitted, TEST_DB env is consulted ('container' opts in,
	 * anything else defaults to 'memory'). Postgres always runs containerized.
	 */
	mode?: TestDbMode
	collections?: Config['collections']
	seed?: (payload: Payload) => Promise<void>
	configOverrides?: Partial<Config>
	/**
	 * Reuse an existing boot's database (a second Payload instance against one DB, for
	 * multi-instance tests). Skips starting a database; the attached `stop()` only
	 * destroys this Payload (the owning boot stops the DB).
	 */
	attachTo?: BootedPayload
}

export interface BootedPayload {
	payload: Payload
	db: SupportedDb
	mode: TestDbMode
	/** The database connection string, for attaching a second instance or a subprocess. */
	connectionString: string
	stop: () => Promise<void>
}

type AnyDbHandle = MongoTestDb | MongoContainerDb | PostgresContainerDb

const resolveMode = (explicit?: TestDbMode): TestDbMode => {
	if (explicit) return explicit
	return process.env.TEST_DB === 'container' ? 'container' : 'memory'
}

const startDb = async (db: SupportedDb, mode: TestDbMode): Promise<AnyDbHandle> => {
	if (db === 'postgres') return startPostgresContainer()
	return mode === 'container' ? startMongoContainer() : startMongo()
}

/**
 * `getPayload` caches instances by `key` (default `'default'`) in a process-global
 * map, so two keyless boots in one process return the same instance. Each boot gets
 * a unique key so a single test file can boot more than once (for example an interop
 * spec that boots with and without a sibling plugin).
 */
let bootSequence = 0

/**
 * Boots a fully initialized Payload instance with the given plugin loaded.
 * Returns the payload instance and a stop() function that tears down the DB.
 * Tests MUST call stop() in afterAll.
 *
 * One call = one payload + one DB. Use describeForDb to parameterize.
 */
export const bootPayload = async (options: BootPayloadOptions): Promise<BootedPayload> => {
	const mode = options.db === 'postgres' ? 'container' : resolveMode(options.mode)

	let adapter: AnyDbHandle['adapter']
	let connectionString: string
	let stopDb: () => Promise<void>
	if (options.attachTo) {
		connectionString = options.attachTo.connectionString
		adapter =
			options.db === 'postgres'
				? postgresAdapter({ pool: { connectionString } })
				: mongooseAdapter({ ensureIndexes: true, url: connectionString })
		stopDb = async () => undefined
	} else {
		const dbHandle = await startDb(options.db, mode)
		adapter = dbHandle.adapter
		connectionString = dbHandle.connectionString
		stopDb = dbHandle.stop
	}

	// Payload's pushDevSchema caches the last-pushed schema in a module-level global and skips
	// the push when the next boot's schema is identical. Every test boot uses a fresh database,
	// so a second same-schema boot would otherwise receive no tables. Force the push each boot.
	if (options.db === 'postgres') {
		process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
	}

	const baseConfig: Config = {
		secret: 'test-secret-not-for-prod',
		db: adapter,
		collections: options.collections ?? [],
		typescript: { autoGenerate: false, outputFile: '/dev/null' },
		admin: { importMap: { autoGenerate: false } },
		telemetry: false,
		...options.configOverrides,
		plugins: [options.plugin, ...(options.configOverrides?.plugins ?? [])],
	}

	const key = `bootPayload-${bootSequence++}`
	const payload = await getPayload({ config: buildConfig(baseConfig), key })

	if (options.seed) {
		await options.seed(payload)
	}

	return {
		payload,
		db: options.db,
		mode,
		connectionString,
		stop: async () => {
			// Payload's drizzle destroy() never ends the pg pool (it holds a
			// never-released health client, so pool.end() would hang), so idle
			// connections stay open when stopDb() SIGKILLs the container. pg surfaces
			// the backend's 57P01 on the pool 'error' event and needs a listener there
			// or it throws uncaught; the termination is expected, so swallow it. Mongo
			// has no pool, so this no-ops. When attached, only this Payload is
			// destroyed; the owning boot stops the DB.
			const pgPool = (
				payload.db as { pool?: { on: (event: 'error', listener: (err: unknown) => void) => void } }
			).pool
			pgPool?.on('error', () => undefined)
			await payload.destroy()
			await stopDb()
		},
	}
}
