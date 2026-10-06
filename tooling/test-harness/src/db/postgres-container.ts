// biome-ignore-all lint/plugin/noProcessEnv: test harness env boundary (shared server handoff)
import { postgresAdapter } from '@payloadcms/db-postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

export interface PostgresContainerDb {
	adapter: ReturnType<typeof postgresAdapter>
	stop: () => Promise<void>
	connectionString: string
}

export interface SharedPostgresServer {
	/** Base connection string; each boot swaps in its own database name. */
	serverUrl: string
	stop: () => Promise<void>
}

/**
 * Env var a shared server publishes itself on. A suite opts in by starting
 * `startSharedPostgresServer` from a vitest globalSetup; every `startPostgresContainer` in
 * that run then takes a database on it instead of starting a container of its own.
 */
export const SHARED_POSTGRES_SERVER_ENV = 'PAYLOAD_TEST_POSTGRES_SERVER'

const uniqueDbName = (): string =>
	`test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${process.pid}`

const postgresImage = (): GenericContainer =>
	new GenericContainer('postgres:16')
		.withExposedPorts(5432)
		// Postgres logs this line twice: once for the temporary initdb server, then
		// for the real one. Wait for the second so connections do not race startup.
		.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))

/**
 * Boots one `postgres:16` container meant to host many test databases for a whole vitest run.
 * Durability is off and the connection ceiling raised, because the data lives as long as the
 * container does and every spec file holds its own pool.
 */
export const startSharedPostgresServer = async (): Promise<SharedPostgresServer> => {
	const container: StartedTestContainer = await postgresImage()
		.withEnvironment({
			POSTGRES_USER: 'test',
			POSTGRES_PASSWORD: 'test',
			POSTGRES_DB: 'postgres',
		})
		.withCommand([
			'postgres',
			'-c',
			'max_connections=400',
			'-c',
			'fsync=off',
			'-c',
			'synchronous_commit=off',
			'-c',
			'full_page_writes=off',
		])
		.start()

	return {
		serverUrl: `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`,
		stop: async () => {
			await container.stop({ timeout: 0, remove: true, removeVolumes: true })
		},
	}
}

/**
 * Takes a fresh database on an already-running shared server. Payload's postgres adapter
 * creates the database on connect, so nothing needs a management client here.
 */
const databaseOnSharedServer = (serverUrl: string): PostgresContainerDb => {
	const url = new URL(serverUrl)
	url.pathname = `/${uniqueDbName()}`
	const connectionString = url.toString()

	return {
		// Many pools share one server, so each stays small enough to fit under max_connections.
		adapter: postgresAdapter({ pool: { connectionString, max: 4 } }),
		connectionString,
		stop: async () => undefined,
	}
}

/**
 * Boots a real `postgres:16` container via testcontainers. This is the only
 * supported Postgres test path (matches Payload's own monorepo pattern; no
 * in-process Postgres). Requires Docker.
 *
 * When a shared server has published itself on `PAYLOAD_TEST_POSTGRES_SERVER`, this returns a
 * database on that server instead, and `stop()` becomes a no-op (the server's owner tears it down).
 */
export const startPostgresContainer = async (): Promise<PostgresContainerDb> => {
	const sharedServer = process.env[SHARED_POSTGRES_SERVER_ENV]
	if (sharedServer) {
		return databaseOnSharedServer(sharedServer)
	}

	const dbName = uniqueDbName()
	const container: StartedTestContainer = await postgresImage()
		.withEnvironment({
			POSTGRES_USER: 'test',
			POSTGRES_PASSWORD: 'test',
			POSTGRES_DB: dbName,
		})
		.start()

	const host = container.getHost()
	const port = container.getMappedPort(5432)
	const connectionString = `postgres://test:test@${host}:${port}/${dbName}`
	const adapter = postgresAdapter({ pool: { connectionString } })

	return {
		adapter,
		connectionString,
		stop: async () => {
			// SIGKILL immediately. Tests don't care about graceful postgres shutdown
			// and a graceful stop adds 5+ seconds we can't afford in afterAll. The pg
			// pool is closed by bootPayload before this runs.
			await container.stop({ timeout: 0, remove: true, removeVolumes: true })
		},
	}
}
