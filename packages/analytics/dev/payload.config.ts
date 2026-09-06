// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig } from 'payload'
import { analyticsTab } from '../src/index'
import { singleFragment } from './config/single'
import { tenancyFragment } from './config/tenancy'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'
const tenancy = process.env.TENANCY === 'on'
const fragment = tenancy ? tenancyFragment : singleFragment

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

const pages: CollectionConfig = {
	slug: 'pages',
	admin: { useAsTitle: 'title' },
	fields: [
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Content',
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'slug', type: 'text', required: true },
					],
				},
				analyticsTab(),
			],
		},
	],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/analytics_e2e',
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
	collections: [users, pages, ...fragment.collections],
	plugins: fragment.plugins,
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload, { tenancy })
	},
	typescript: { autoGenerate },
	admin: {
		importMap: { autoGenerate, baseDir: path.resolve(dirname) },
		dashboard: fragment.dashboard,
	},
})
