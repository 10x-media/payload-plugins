// biome-ignore-all lint/plugin/noProcessEnv: upgrade test env boundary
import { analytics } from '@10x-media/analytics'
import { native } from '@10x-media/analytics/adapters/native'
import { buildConfig, type Config, type PayloadRequest } from 'payload'

/**
 * scripts/upgrade/beta11/payload.config.ts after the upgrade, per `UPGRADE_VARIANT`, its options
 * rewritten as the upgrading page says and loaded from the built package as a host loads it.
 */

const required = (name: string): string => {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} is required`)
	}
	return value
}

const database = async (): Promise<Config['db']> => {
	const migrationDir = required('UPGRADE_MIGRATIONS')
	const url = required('UPGRADE_DATABASE_URL')
	const db = required('UPGRADE_DB')
	if (db === 'postgres') {
		const { postgresAdapter } = await import('@payloadcms/db-postgres')
		return postgresAdapter({ migrationDir, pool: { connectionString: url } })
	}
	if (db === 'sqlite') {
		const { sqliteAdapter } = await import('@payloadcms/db-sqlite')
		return sqliteAdapter({ migrationDir, client: { url } })
	}
	const { mongooseAdapter } = await import('@payloadcms/db-mongodb')
	return mongooseAdapter({ migrationDir, url, ensureIndexes: true })
}

const variant = required('UPGRADE_VARIANT')

/** A beacon's tenant is the first label of its host; the platform's readers pick one by header. */
const resolveTenant = ({
	req,
	callSite,
}: {
	req: PayloadRequest
	callSite: 'capture' | 'admin'
}): string | null => {
	if (callSite === 'admin') {
		return req.headers.get('x-upgrade-tenant')
	}
	const host = req.headers.get('host') ?? ''
	return host.endsWith('.upgrade.test') ? host.slice(0, -'.upgrade.test'.length) : null
}

const scoped =
	variant === 'scoped'
		? {
				scope: { resolve: resolveTenant, member: () => true, list: () => ['alpha', 'beta'] },
				access: {
					crossScope: ({ req }: { req: PayloadRequest }) => req.user?.collection === 'users',
				},
			}
		: {}

export default buildConfig({
	secret: required('UPGRADE_SECRET'),
	db: await database(),
	collections: [
		{ slug: 'users', auth: true, fields: [] },
		{ slug: 'pages', fields: [{ name: 'title', type: 'text' }] },
	],
	plugins: [
		analytics({
			...scoped,
			adapters: [native()],
			capture: { gate: ({ kind }) => kind !== 'native' },
			cache: { warm: variant === 'tasks' },
			sync: variant === 'tasks' || variant === 'sync',
			goals: { collection: true },
			providers: { collection: true },
		}),
	],
	telemetry: false,
	typescript: { autoGenerate: false },
	admin: { importMap: { autoGenerate: false } },
})
