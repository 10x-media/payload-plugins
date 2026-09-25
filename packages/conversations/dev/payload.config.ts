// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig, type PayloadRequest, type Where } from 'payload'
import { comments } from '../src/exports/comments'
import { conversations, defineMessageType, perTarget } from '../src/index'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'name' },
	fields: [{ name: 'name', type: 'text' }],
}

/** Website accounts: they read and write the shared channel of their own persons only. */
const customers: CollectionConfig = {
	slug: 'customers',
	auth: true,
	admin: { useAsTitle: 'name' },
	fields: [{ name: 'name', type: 'text' }],
}

const persons: CollectionConfig = {
	slug: 'persons',
	admin: { useAsTitle: 'name' },
	versions: { drafts: true },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'owner', type: 'relationship', relationTo: 'customers' },
		{ name: 'notes', type: 'textarea' },
	],
}

const media: CollectionConfig = {
	slug: 'media',
	admin: { useAsTitle: 'title' },
	fields: [{ name: 'title', type: 'text', required: true }],
}

const isStaff = (req: PayloadRequest) => req.user?.collection === 'users'

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/conversations_e2e',
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
	collections: [users, customers, persons, media],
	plugins: [
		conversations({
			slug: 'comments',
			users: ['users', 'customers'],
			// Staff see every conversation; a customer only those of persons they own.
			access: perTarget(
				({ doc, req }) =>
					isStaff(req) ||
					(req.user?.collection === 'customers' &&
						String(doc?.owner ?? '') === String(req.user.id)),
				{ load: true }
			),
			channels: [
				{
					slug: 'internal',
					label: 'Internal',
					cue: { label: 'Internal · staff only', tone: 'neutral' },
					access: { read: ({ req }) => isStaff(req), create: ({ req }) => isStaff(req) },
				},
				{
					slug: 'shared',
					label: 'Shared',
					cue: { label: 'Shared · visible to the customer', tone: 'warning' },
					access: { read: () => true, create: () => true },
				},
			],
			mentions: {
				// Customers are mentionable only by staff; the channel rule filters the rest.
				users: ({ collection, req }): Where =>
					collection === 'customers' && !isStaff(req) ? { id: { exists: false } } : {},
			},
			hooks: {
				afterMention: ({ req, users: mentioned, key }) => {
					req.payload.logger.info(
						`[dev] mentioned ${mentioned.map((u) => `${u.collection}:${u.id}`).join(', ')} in ${key}`
					)
				},
			},
			types: [
				defineMessageType<{ from: string; to: string }>()({
					slug: 'person.status',
					Component: '/components/StatusChange#StatusChange',
					validate: (data) => (data?.from && data.to ? true : 'from and to are required'),
				}),
			],
			extensions: [comments({ collections: { persons: true, media: ['internal'] } })],
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		user: 'users',
		components: {
			afterNavLinks: ['/playground/PlaygroundNavLink#PlaygroundNavLink'],
			views: {
				playground: {
					Component: '/playground/PlaygroundView#PlaygroundView',
					exact: true,
					meta: { title: 'UI playground' },
					path: '/playground',
				},
			},
		},
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
