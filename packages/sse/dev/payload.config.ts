// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig, type CollectionConfig } from 'payload'
import { multiTenantScope, sse } from '../src/index'
import { startMemoryMongo } from './helpers/memoryDb'
import { PLATFORM_ADMIN_EMAIL, seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

export const isPlatformAdmin = (user: unknown): boolean => {
	if (!user || typeof user !== 'object' || !('email' in user)) {
		return false
	}
	return (user as { email?: unknown }).email === PLATFORM_ADMIN_EMAIL
}

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [{ name: 'name', type: 'text' }],
}

const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [{ name: 'name', type: 'text', required: true }],
}

/** Unscoped e2e collection. Writes with no tenant publish to `*::posts` only. */
const posts: CollectionConfig = {
	slug: 'posts',
	lockDocuments: false,
	admin: { useAsTitle: 'title' },
	fields: [{ name: 'title', type: 'text', required: true }],
}

const pages: CollectionConfig = {
	slug: 'pages',
	lockDocuments: false,
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			name: 'status',
			type: 'select',
			defaultValue: 'draft',
			options: [
				{ label: 'Draft', value: 'draft' },
				{ label: 'Live', value: 'live' },
				{ label: 'Archived', value: 'archived' },
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
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/sse_e2e',
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
	collections: [users, tenants, posts, pages],
	plugins: [
		sse({
			collections: {
				posts: true,
				pages: { thinEvents: false },
			},
			presence: { profile: 'drawer' },
			admin: { liveList: { field: 'title' }, presence: true, conflict: true },
			scope: multiTenantScope({ userHasAccessToAllTenants: isPlatformAdmin }),
		}),
		multiTenantPlugin({
			collections: { pages: {} },
			debug: true,
			userHasAccessToAllTenants: isPlatformAdmin,
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
