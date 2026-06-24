// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig } from 'payload'
import { sipgate } from '../src/index'
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

const contacts: CollectionConfig = {
	slug: 'contacts',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'phoneNumber', type: 'text' },
	],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/sipgate_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url:
					process.env.DATABASE_URI_MONGO ??
					'mongodb://localhost:27017/sipgate_e2e?replicaSet=rs0&directConnection=true',
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db,
	collections: [users, contacts],
	plugins: [
		sipgate({
			contactCollections: [contacts.slug],
			phoneNumberFields: ['phoneNumber'],
			syncCallLogs: true,
			sipgateCredentials: {
				authType: 'pat',
				tokenId: process.env.SIPGATE_TOKEN_ID,
				token: process.env.SIPGATE_TOKEN,
			},
			enableCallActivityWidget: true,
			enableLiveCallFloatingWindow: true,
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
