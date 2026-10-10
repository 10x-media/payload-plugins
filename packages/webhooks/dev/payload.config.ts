// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig } from 'payload'
import { Webhook } from 'standardwebhooks'
import { webhooks } from '../src/index'
import { startMemoryMongo } from './helpers/memoryDb'
import { DEV_SINK_SECRET, seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'
const port = process.env.PORT ?? '3000'
const serverURL = process.env.PAYLOAD_PUBLIC_SERVER_URL ?? `http://localhost:${port}`

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title' },
	fields: [{ name: 'title', type: 'text' }],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/webhooks_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	serverURL,
	db,
	collections: [users, posts],
	endpoints: [
		{
			path: '/webhook-sink',
			method: 'post',
			handler: async (req) => {
				const body = req.text ? await req.text() : ''
				// Verified with the reference library rather than the plugin's own signer, so a
				// delivery the sink accepts is one any Standard Webhooks receiver would accept. A
				// rejection is a 401, which shows up as a failed delivery row.
				try {
					new Webhook(DEV_SINK_SECRET).verify(body, Object.fromEntries(req.headers))
				} catch (err) {
					req.payload.logger.warn(
						`[webhook-sink] rejected ${req.headers.get('x-webhook-event')}: ${err instanceof Error ? err.message : String(err)}`
					)
					return Response.json({ error: 'invalid signature' }, { status: 401 })
				}
				req.payload.logger.info(
					`[webhook-sink] verified ${req.headers.get('x-webhook-event')} ${body.slice(0, 200)}`
				)
				return Response.json({ received: true }, { status: 200 })
			},
		},
	],
	plugins: [
		webhooks({
			collections: { posts: true },
			// The sink is this app's own /api/webhook-sink on localhost.
			delivery: { mode: 'inline', allowHttp: true, allowPrivateAddresses: true },
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
