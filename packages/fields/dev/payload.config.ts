// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { de } from '@payloadcms/translations/languages/de'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig, type CollectionConfig } from 'payload'
import { lucideAdapter } from '../src/exports/icon-adapters/lucide'
import { radixAdapter } from '../src/exports/icon-adapters/radix'
import { tablerAdapter } from '../src/exports/icon-adapters/tabler'
import { fields } from '../src/index'
import { colors } from './collections/colors'
import { icons } from './collections/icons'
import { tenants } from './collections/tenants'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/fields_e2e',
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
	collections: [users, colors, tenants, icons],
	i18n: { supportedLanguages: { de, en } },
	localization: { defaultLocale: 'en', locales: ['en', 'de'] },
	plugins: [
		fields({
			color: {
				presets: ['#16a34a', '#dc2626', { key: 'global', label: 'Global blue', value: '#1d4ed8' }],
			},
			icon: {
				adapters: [lucideAdapter(), radixAdapter(), tablerAdapter()],
				defaultLibrary: 'lucide',
			},
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
