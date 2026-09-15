// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

// Source imports, not the package name: the payload bin runs this file through tsx, which does
// not apply the `development` export condition, so the package name would resolve to `dist`.
// Dev components are bundled by Next and import the package name as a consumer would.
import { formVariants } from '../src/index'
import {
	articles,
	companies,
	containers,
	events,
	openings,
	pages,
	people,
	secrets,
	users,
} from './collections'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'
import { articleVariants } from './variants/articles'

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
						'postgres://e2e:e2e@localhost:35432/form-variants_e2e',
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
	collections: [users, people, companies, openings, events, articles, secrets, containers, pages],
	editor: lexicalEditor(),
	// `pages` is the localized collection; the rest ignore locales, so the switcher is only
	// meaningful there.
	localization: {
		defaultLocale: 'en',
		fallback: true,
		locales: [
			{ code: 'en', label: 'English' },
			{ code: 'de', label: 'Deutsch' },
			{ code: 'uk', label: 'Українська' },
		],
	},
	// Last, so it sees every collection. Most collections carry their own variants; articles
	// are configured here, as a collection owned by another plugin would be.
	plugins: [formVariants({ collections: { articles: articleVariants } })],
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
		user: users.slug,
	},
})
