// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig } from 'payload'
import { jobs } from '../src/index'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'
import { e2eTasks, e2eWorkflows, RELIABILITY_OPTIONS } from './jobsOptions'

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
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/jobs_e2e',
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
	collections: [users],
	jobs: { tasks: e2eTasks, workflows: e2eWorkflows },
	plugins: [
		jobs({
			// Demo of the log-slot seam: `sleep` gets server-rendered input and output,
			// every task gets the client-rendered error card, and `inline` attempts keep
			// the default JSON blocks so the contrast is visible in one document.
			// `sleep` shows a hand-written example winning over the derived `{ ms: 0 }`.
			input: { examples: { sleep: { ms: 1500 } } },
			log: {
				entryComponents: {
					'*': { error: '/components/AttemptError#AttemptError' },
					sleep: {
						input: '/components/SleepInput#SleepInput',
						output: '/components/SleepOutput#SleepOutput',
					},
				},
			},
			queueControl: { queues: ['default', 'emails', 'webhooks'] },
			reliability: RELIABILITY_OPTIONS,
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		if (process.env.JOBS_SKIP_SEED !== '1') {
			await seedDev(payload)
		}
	},
	typescript: { autoGenerate },
	admin: {
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
