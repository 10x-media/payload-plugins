// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig, type CollectionSlug } from 'payload'
import { wildix } from '../src/index'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'
const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000'
const webhookUrl = process.env.WEBHOOK_URL ?? siteUrl
const authType = process.env.WILDIX_AUTH_TYPE === 'oauth2' ? 'oauth2' : 'apiKey'

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
		{ name: 'phoneNumber', type: 'text', admin: { width: '50%' } },
	],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/wildix_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	serverURL: siteUrl,
	// serverURL (ngrok) is auto-whitelisted; localhost needed when opening admin without the tunnel
	csrf: ['http://localhost:3000', 'http://127.0.0.1:3000'],
	db,
	collections: [users, contacts],
	plugins: [
		wildix({
			contactCollections: [contacts.slug as CollectionSlug],
			phoneNumberFields: ['phoneNumber'],
			payloadUsersSlug: 'users',
			syncCallLogs: true,
			webhookUrl: authType === 'oauth2' ? webhookUrl : undefined,
			webhookSecret: process.env.WILDIX_WEBHOOK_SECRET,
			wildixCredentials:
				authType === 'oauth2'
					? {
							authType: 'oauth2',
							pbxHost: process.env.WILDIX_PBX_HOST,
							clientId: process.env.WILDIX_CLIENT_ID,
							clientSecret: process.env.WILDIX_CLIENT_SECRET,
							company: process.env.WILDIX_COMPANY,
						}
					: {
							authType: 'apiKey',
							pbxHost: process.env.WILDIX_PBX_HOST,
							apiKey: process.env.WILDIX_API_KEY,
							company: process.env.WILDIX_COMPANY,
						},
			enableCallActivityWidget: true,
			enableLiveCallFloatingWindow: true,
			enableContactMatchUi: true,
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
