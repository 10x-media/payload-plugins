// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyticsStat, analyticsTab } from '@10x-media/analytics'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, type CollectionConfig, type DatabaseAdapterObj } from 'payload'
import { ar } from 'payload/i18n/ar'
import { de } from 'payload/i18n/de'
import { en } from 'payload/i18n/en'
import { ctaBlock } from './config/shared'
import { singleFragment } from './config/single'
import { tenancyFragment } from './config/tenancy'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'
import { migrations as postgresMigrations } from './migrations/postgres/index'
import { migrations as postgresTenancyMigrations } from './migrations/postgres-tenancy/index'
import { migrations as sqliteMigrations } from './migrations/sqlite/index'
import { migrations as sqliteTenancyMigrations } from './migrations/sqlite-tenancy/index'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const devDb = process.env.DEV_DB
const useDb = devDb === 'postgres' || devDb === 'sqlite' ? devDb : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'
const tenancy = process.env.TENANCY === 'on'
const fragment = tenancy ? tenancyFragment : singleFragment

/**
 * A SQL migration carries the schema snapshot of its config, so each tenancy mode keeps its own
 * chain on Postgres and on SQLite.
 */
const migrationDir = path.resolve(
	dirname,
	'migrations',
	useDb !== 'mongo' && tenancy ? `${useDb}-tenancy` : useDb
)

/** The SQLite file, gitignored with its WAL files; libsql creates the file, not its folder. */
const sqliteFile = (): string => {
	const folder = path.resolve(dirname, '.sqlite')
	mkdirSync(folder, { recursive: true })
	return `file:${path.join(folder, tenancy ? 'analytics-tenancy.db' : 'analytics.db')}`
}

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

/**
 * Both field factories where an editor meets them: the interactive panel in the Analytics tab
 * and a single stat in the sidebar.
 */
const pages: CollectionConfig = {
	slug: 'pages',
	admin: { useAsTitle: 'title' },
	fields: [
		analyticsStat({ metric: 'pageviews', position: 'sidebar' }),
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Content',
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'slug', type: 'text', required: true },
						{ name: 'layout', type: 'blocks', blocks: [ctaBlock] },
					],
				},
				analyticsTab(),
			],
		},
	],
}

/**
 * `prodMigrations` is the chain `next start` applies at boot. Production never pushes a schema
 * (db-postgres and db-sqlite `connect` push only outside it), so without it a fresh database has
 * no tables.
 */
const databaseAdapter = async (): Promise<DatabaseAdapterObj> => {
	switch (useDb) {
		case 'postgres':
			return postgresAdapter({
				migrationDir,
				prodMigrations: tenancy ? postgresTenancyMigrations : postgresMigrations,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/analytics_e2e',
				},
			})
		case 'sqlite':
			return sqliteAdapter({
				migrationDir,
				prodMigrations: tenancy ? sqliteTenancyMigrations : sqliteMigrations,
				client: { url: process.env.DATABASE_URI_SQLITE ?? sqliteFile() },
				// What the engine's worker threads need, so a dev boot runs them.
				wal: true,
				busyTimeout: 5000,
			})
		default:
			return mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})
	}
}

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db: await databaseAdapter(),
	collections: [users, pages, ...fragment.collections],
	plugins: fragment.plugins,
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload, { tenancy })
	},
	// Looks for due jobs every minute; analytics-maintain itself falls due every 15 minutes.
	jobs: { autoRun: [{ cron: '* * * * *', queue: 'default' }] },
	typescript: { autoGenerate },
	// Arabic and German beside English, so the admin can be checked right to left and in a second
	// left-to-right language from the account page.
	i18n: { supportedLanguages: { ar, de, en } },
	admin: {
		importMap: { autoGenerate, baseDir: path.resolve(dirname) },
		dashboard: fragment.dashboard,
	},
})
