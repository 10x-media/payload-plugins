import { postgresAdapter } from '@payloadcms/db-postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'

export interface PostgresContainerDb {
	adapter: ReturnType<typeof postgresAdapter>
	stop: () => Promise<void>
	connectionString: string
}

/**
 * Boots a real `postgres:16` container via testcontainers. This is the only
 * supported Postgres test path (matches Payload's own monorepo pattern; no
 * in-process Postgres). Requires Docker.
 */
export const startPostgresContainer = async (): Promise<PostgresContainerDb> => {
	const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
	const container: StartedTestContainer = await new GenericContainer('postgres:16')
		.withEnvironment({
			POSTGRES_USER: 'test',
			POSTGRES_PASSWORD: 'test',
			POSTGRES_DB: dbName,
		})
		.withExposedPorts(5432)
		// Postgres logs this line twice: once for the temporary initdb server, then
		// for the real one. Wait for the second so connections do not race startup.
		.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
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
