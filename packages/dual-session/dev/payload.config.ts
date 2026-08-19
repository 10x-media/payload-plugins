// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'
import { dualSession } from '../src/index'
import { customers, isolateWebsiteUsers, notes, partners, siteSettings, users } from './collections'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/dual-session_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db,
	collections: [users, partners, customers, notes],
	globals: [siteSettings],
	plugins: [
		// Order is priority: a visitor holding several isolated sessions resolves as the first
		// listed. `users` backs the admin panel, so it may only be listed with a predicate: the
		// staff half stays on the shared cookie and the panel is untouched.
		dualSession({
			collections: [
				{ slug: 'partners', cookieName: 'partner-session' },
				'customers',
				{ slug: 'users', isolate: isolateWebsiteUsers },
			],
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		user: 'users',
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
