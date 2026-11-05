// biome-ignore-all lint/plugin/noProcessEnv: upgrade test env boundary
import { buildConfig, type Config, type PayloadRequest } from 'payload'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'

/**
 * A host as it ran 1.0.0-beta.11: the native engine with the goals and providers collections, in
 * the shape `UPGRADE_VARIANT` names. `tasks` adds its retention task, warming and sync, so Payload's
 * jobs ran before the upgrade; `none` runs no task; `sync` runs sync alone, so the jobs table's task
 * enum holds none of the retired tasks; `scoped` is a multi-tenant install whose tenants are the
 * first label of the request's host. scripts/upgrade.sh copies this file into a checkout of that
 * tag (`packages/analytics/dev/upgrade/`), so every import resolves to that release. It is never
 * typechecked against the current tree, whose options it would fail.
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
	// As beta.11's own dev app ran it: on a fresh database the indexes are then built at boot,
	// not raced by the first event's transaction, which Mongo refuses over the catalog change.
	return mongooseAdapter({ migrationDir, url, ensureIndexes: true })
}

const variant = required('UPGRADE_VARIANT')

/** `alpha.upgrade.test` is the tenant `alpha`; any other host is the whole install. */
const tenantOfHost = (req: PayloadRequest): string | null => {
	const host = req.headers.get('host') ?? ''
	return host.endsWith('.upgrade.test') ? host.slice(0, -'.upgrade.test'.length) : null
}

const scoped =
	variant === 'scoped'
		? {
				scopeResolver: ({ req }: { req: PayloadRequest }) => tenantOfHost(req),
				scopes: () => ['alpha', 'beta'],
				access: { platformRead: ({ req }: { req: PayloadRequest }) => Boolean(req.user) },
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
			adapters: [native(variant === 'tasks' ? { retentionDays: 90 } : {})],
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
