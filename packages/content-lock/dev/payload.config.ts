// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jobs } from '@10x-media/jobs'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig, type GlobalConfig } from 'payload'
import { contentLock } from '../src/index'
import { playgroundTasks, startDevWorker } from './helpers/jobs'
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

const titled = (slug: string, group: string): CollectionConfig => ({
	slug,
	admin: { useAsTitle: 'title', group },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'body', type: 'richText' },
	],
})

const header: GlobalConfig = {
	slug: 'header',
	admin: { group: 'Site' },
	fields: [{ name: 'tagline', type: 'text' }],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/content-lock_e2e',
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
	editor: lexicalEditor(),
	collections: [
		users,
		titled('pages', 'Site'),
		titled('posts', 'Site'),
		titled('products', 'Catalog'),
		titled('categories', 'Catalog'),
	],
	globals: [header],
	localization: { locales: ['en', 'de'], defaultLocale: 'en' },
	i18n: { fallbackLanguage: 'en' },
	jobs: { deleteJobOnComplete: false, tasks: playgroundTasks },
	plugins: [
		jobs({ reliability: true }),
		contentLock({
			groups: [
				{
					key: 'catalog',
					label: { en: 'Catalog', de: 'Katalog' },
					collections: ['products', 'categories'],
				},
				{
					key: 'site',
					label: { en: 'Website', de: 'Website' },
					collections: ['pages', 'posts'],
					globals: ['header'],
				},
			],
			individualSelection: true,
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
		startDevWorker(payload)
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
