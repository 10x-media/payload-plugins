// biome-ignore-all lint/plugin/noProcessEnv: test harness env boundary (TEST_DB)
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type Config, getPayload, type Payload, type Plugin } from 'payload'
import { type MongoTestDb, startMongo } from './db/mongo'
import { type MongoContainerDb, startMongoContainer } from './db/mongo-container'
import {
	type PostgresContainerDb,
	SHARED_POSTGRES_SERVER_ENV,
	startPostgresContainer,
} from './db/postgres-container'
import type { SqliteTestDb } from './db/sqlite'
import { settleBeforeRelease } from './release'

export type SupportedDb = 'mongo' | 'postgres' | 'sqlite'

/**
 * Where a boot's database lives. Mongo runs in-memory (default) or in a real container;
 * Postgres always runs in a real container (Payload's own test pattern, no in-process
 * Postgres); SQLite always runs on a temp file.
 */
export type TestDbMode = 'memory' | 'container' | 'file'

export interface BootPayloadOptions {
	plugin: Plugin
	db: SupportedDb
	/**
	 * Mongo only. When omitted, TEST_DB env is consulted ('container' opts in,
	 * anything else defaults to 'memory'). Postgres always runs containerized, SQLite on a file.
	 */
	mode?: Exclude<TestDbMode, 'file'>
	collections?: Config['collections']
	seed?: (payload: Payload) => Promise<void>
	configOverrides?: Partial<Config>
	/**
	 * Reuse an existing boot's database (a second Payload instance against one DB, for
	 * multi-instance tests). Skips starting a database; the attached `stop()` only
	 * destroys this Payload (the owning boot stops the DB). On SQLite both instances open
	 * the same file.
	 */
	attachTo?: BootedPayload
	/** Boots without running any `onInit` (the config's or a plugin's), as a jobs worker does. */
	disableOnInit?: boolean
}

export interface BootedPayload {
	payload: Payload
	db: SupportedDb
	mode: TestDbMode
	/** The database connection string, for attaching a second instance or a subprocess. */
	connectionString: string
	/**
	 * The `getPayload` cache key this instance is stored under. Pass it as
	 * `payloadInstanceCacheKey` to `handleEndpoints` so a REST request resolves to this
	 * instance instead of booting a second one against the default key.
	 */
	cacheKey: string
	stop: () => Promise<void>
}

type AnyDbHandle = MongoTestDb | MongoContainerDb | PostgresContainerDb | SqliteTestDb

/**
 * The slice of node-postgres' `Pool` teardown needs. Payload types `payload.db` as the base
 * adapter, so the drizzle adapter's pool is only reachable by structural check.
 */
type TeardownPool = {
	on: (event: 'error', listener: (err: unknown) => void) => void
	end: () => Promise<void>
}

const isTeardownPool = (value: unknown): value is TeardownPool =>
	typeof value === 'object' &&
	value !== null &&
	'on' in value &&
	typeof value.on === 'function' &&
	'end' in value &&
	typeof value.end === 'function'

const teardownPoolOf = (db: Payload['db']): TeardownPool | undefined =>
	'pool' in db && isTeardownPool(db.pool) ? db.pool : undefined

/** The libsql client, which `payload.destroy()` leaves open; reachable only structurally. */
type ClosableClient = { close: () => void }

const isClosableClient = (value: unknown): value is ClosableClient =>
	typeof value === 'object' &&
	value !== null &&
	'close' in value &&
	typeof value.close === 'function'

const sqliteClientOf = (db: Payload['db']): ClosableClient | undefined =>
	'client' in db && isClosableClient(db.client) ? db.client : undefined

/**
 * Releases what one Payload instance opened, once the `onRelease` hooks let its background work
 * settle: its crons and adapter, the pg pool drizzle's `destroy()` leaves open, and the libsql
 * client. A boot that failed part way may have no adapter yet.
 */
const releaseInstance = async (payload: Payload, db: SupportedDb): Promise<void> => {
	await settleBeforeRelease(payload)
	await payload.destroy()
	const adapter: Payload['db'] | undefined = payload.db
	if (!adapter) {
		return
	}
	// A per-boot container is SIGKILLed right after, terminating its idle connections (57P01),
	// so there the handler is enough; on a shared server nothing is killed between boots, so end
	// the pool, unawaited because a test still holding a checked-out client would hang the await.
	const pool = teardownPoolOf(adapter)
	pool?.on('error', () => undefined)
	if (process.env[SHARED_POSTGRES_SERVER_ENV]) {
		void pool?.end().catch(() => undefined)
	}
	if (db === 'sqlite') {
		sqliteClientOf(adapter)?.close()
	}
}

/** The adapter as given, reporting the instance it is initialized for. */
const reportingInstance = (
	adapter: Config['db'],
	onInit: (payload: Payload) => void
): Config['db'] => ({
	...adapter,
	init: (args) => {
		onInit(args.payload)
		return adapter.init(args)
	},
})

const resolveMode = (explicit?: TestDbMode): TestDbMode => {
	if (explicit) return explicit
	return process.env.TEST_DB === 'container' ? 'container' : 'memory'
}

const modeFor = (db: SupportedDb, explicit?: TestDbMode): TestDbMode => {
	if (db === 'postgres') return 'container'
	if (db === 'sqlite') return 'file'
	return resolveMode(explicit)
}

// Loaded on first use, so a run that boots no SQLite never loads libsql's native module.
const sqliteHarness = () => import('./db/sqlite')

const startDb = async (db: SupportedDb, mode: TestDbMode): Promise<AnyDbHandle> => {
	if (db === 'postgres') return startPostgresContainer()
	if (db === 'sqlite') return (await sqliteHarness()).startSqlite()
	return mode === 'container' ? startMongoContainer() : startMongo()
}

/** A second adapter on an existing boot's database, so two instances share one store. */
const attachedAdapter = async (
	db: SupportedDb,
	connectionString: string
): Promise<AnyDbHandle['adapter']> => {
	if (db === 'postgres') return postgresAdapter({ pool: { connectionString } })
	if (db === 'sqlite') return (await sqliteHarness()).sqliteTestAdapter(connectionString)
	return mongooseAdapter({ ensureIndexes: true, url: connectionString })
}

/** A Mongoose version model, exposed on the adapter as `payload.db.versions[slug]`. */
type VersionModel = {
	createCollection?: () => Promise<unknown>
	ensureIndexes?: () => Promise<unknown>
}

/**
 * Materialize every drafts/versioned collection's `_<slug>_versions` collection and its indexes up
 * front, outside any transaction. Payload otherwise touches the version collection's catalog on the
 * first versioned write (creating the collection, then its indexes) inside the multi-document
 * transaction that every `create`/`update` opens, and MongoDB forbids catalog changes inside a
 * transaction, so that first write fails on the memory replica set with a catalog-change /
 * lock-timeout error. Creating the collection alone is not enough: the lazy index build is also a
 * catalog change, so both must happen here. The mongoose adapter's own `ensureIndexes` pass at
 * connect (which the harness enables) warms base collections but skips version models, so this
 * closes that gap for the whole test suite, not just the spec that first hit it. Idempotent and
 * best-effort: a collection that already exists (a reused DB via `attachTo`) is left as is.
 */
const warmVersionCollections = async (payload: Payload): Promise<void> => {
	const versions = (payload.db as unknown as { versions?: Record<string, VersionModel> }).versions
	if (!versions) {
		return
	}
	await Promise.all(
		Object.values(versions).map(async (model) => {
			try {
				await model.createCollection?.()
			} catch {
				// Already exists (a reused database): the collection now exists, which is what matters.
			}
			// Build the indexes too, so the first in-transaction write finds a settled catalog.
			await model.ensureIndexes?.()
		})
	)
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
	if (options.attachTo && options.attachTo.db !== options.db) {
		throw new Error(
			`bootPayload: cannot attach a ${options.db} boot to a ${options.attachTo.db} database`
		)
	}
	const mode = options.attachTo?.mode ?? modeFor(options.db, options.mode)

	let adapter: AnyDbHandle['adapter']
	let connectionString: string
	let stopDb: () => Promise<void>
	if (options.attachTo) {
		connectionString = options.attachTo.connectionString
		adapter = await attachedAdapter(options.db, connectionString)
		stopDb = async () => undefined
	} else {
		const dbHandle = await startDb(options.db, mode)
		adapter = dbHandle.adapter
		connectionString = dbHandle.connectionString
		stopDb = dbHandle.stop
	}

	// Payload's pushDevSchema caches the last-pushed schema in a module-level global and skips
	// the push when the next boot's schema is identical. Every test boot uses a fresh database,
	// so a second same-schema boot would otherwise receive no tables. Force the push each boot,
	// on both drizzle adapters.
	if (options.db !== 'mongo') {
		process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'
	}

	// Payload never hands back an instance whose init rejected, so the adapter reports it: a
	// failed boot still has a connection to close and a database to stop.
	let initialized: Payload | undefined
	const baseConfig: Config = {
		secret: 'test-secret-not-for-prod',
		collections: options.collections ?? [],
		// Plugins registering richText fields need a config editor or sanitize throws MissingEditorProp
		editor: lexicalEditor(),
		typescript: { autoGenerate: false, outputFile: '/dev/null' },
		admin: { importMap: { autoGenerate: false } },
		telemetry: false,
		...options.configOverrides,
		db: reportingInstance(options.configOverrides?.db ?? adapter, (instance) => {
			initialized = instance
		}),
		plugins: [options.plugin, ...(options.configOverrides?.plugins ?? [])],
	}

	const key = `bootPayload-${bootSequence++}`
	let payload: Payload
	try {
		payload = await getPayload({
			config: buildConfig(baseConfig),
			key,
			disableOnInit: options.disableOnInit === true,
		})
		if (options.db === 'mongo') {
			await warmVersionCollections(payload)
		}
		if (options.seed) {
			await options.seed(payload)
		}
	} catch (err) {
		if (initialized) {
			await releaseInstance(initialized, options.db).catch(() => undefined)
		}
		await stopDb().catch(() => undefined)
		throw err
	}

	return {
		payload,
		db: options.db,
		mode,
		connectionString,
		cacheKey: key,
		stop: async () => {
			// When attached, only this Payload is released; the owning boot stops the DB, and on
			// SQLite removes the file once every instance closed its own client.
			await releaseInstance(payload, options.db)
			await stopDb()
		},
	}
}
