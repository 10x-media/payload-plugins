// biome-ignore-all lint/plugin/noProcessEnv: vitest globalSetup env boundary
import {
	SHARED_POSTGRES_SERVER_ENV,
	type SharedPostgresServer,
	startSharedPostgresServer,
} from '@10x-media/payload-test-harness/db/postgres-container'

/**
 * The int suite boots Payload ~100 times, so a Postgres container per boot would cost far more
 * than the tests themselves. The Postgres lane starts one server here and every boot takes its
 * own database on it. The Mongo lane and the unit tests load this file and do nothing.
 */
let server: SharedPostgresServer | undefined

const wantsPostgres = (): boolean =>
	(process.env.DB_MATRIX ?? '')
		.split(',')
		.map((db) => db.trim())
		.includes('postgres')

export const setup = async (): Promise<void> => {
	if (!wantsPostgres() || process.env[SHARED_POSTGRES_SERVER_ENV]) {
		return
	}
	server = await startSharedPostgresServer()
	process.env[SHARED_POSTGRES_SERVER_ENV] = server.serverUrl
}

export const teardown = async (): Promise<void> => {
	await server?.stop()
	server = undefined
}
