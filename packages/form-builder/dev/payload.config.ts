// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig } from 'payload'
import { definePollOptionSource, formBuilder } from '../src/index'
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

// Host-owned upload collection backing the plugin's file fields (uploads are bring-your-own).
const formUploads: CollectionConfig = {
	slug: 'form-uploads',
	upload: { staticDir: path.resolve(dirname, 'uploads') },
	access: { create: () => true },
	fields: [],
}

// Demo option source: a sourced poll's choices and outcome come from domain data instead of
// authored options. `decidedWinner` simulates the moment the result is known, driving both the
// admin winner select and `resolvePollOutcome` auto mode.
const athletes = definePollOptionSource<{ eventId?: string; decidedWinner?: string }>({
	type: 'athletes',
	label: 'Athletes (demo)',
	config: [
		{ name: 'eventId', type: 'text' },
		{ name: 'decidedWinner', type: 'text' },
	],
	resolve: () => [
		{ label: 'Ada Lovelace', value: 'ada' },
		{ label: 'Grace Hopper', value: 'grace' },
		{ label: 'Margaret Hamilton', value: 'margaret' },
	],
	resolveOutcome: ({ config }) =>
		typeof config.decidedWinner === 'string' && config.decidedWinner.length > 0
			? config.decidedWinner
			: undefined,
})

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/form-builder_e2e',
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
	collections: [users, formUploads],
	plugins: [
		formBuilder({ uploads: { collection: 'form-uploads' }, poll: { sources: { athletes } } }),
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
