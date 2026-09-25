// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig, type PayloadRequest, type Where } from 'payload'
import { comments } from '../src/exports/comments'
import { reactions } from '../src/exports/reactions'
import { conversations, defineMessageType, perTarget } from '../src/index'
import { autoReply } from './helpers/autoReply'
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

/** Chat rooms: each room is the target of a conversation in the `chat` instance. */
const rooms: CollectionConfig = {
	slug: 'rooms',
	admin: { group: 'Chat', useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'topic', type: 'text' },
	],
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
	collections: [users, customers, persons, media, rooms],
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
				// Whoever you mention answers a few seconds later (dev only).
				afterMention: autoReply('comments'),
			},
			types: [
				defineMessageType<{ from: string; to: string }>()({
					slug: 'person.status',
					Component: '/components/StatusChange#StatusChange',
					validate: (data) => (data?.from && data.to ? true : 'from and to are required'),
				}),
			],
			extensions: [
				comments({ collections: { persons: true, media: ['internal'] } }),
				reactions({
					maxPerUser: 3,
					hooks: {
						afterReaction: ({ emoji, message, operation, req, userKey }) => {
							req.payload.logger.info(
								`[dev] ${userKey} ${operation === 'add' ? 'reacted' : 'took back'} ${emoji} on a message by ${message.authorKey}`
							)
						},
					},
				}),
			],
		}),
		// A second instance: a Slack-like chat over `rooms`, one channel per room, staff only.
		conversations({
			slug: 'chat',
			users: ['users'],
			access: perTarget(({ req }) => isStaff(req)),
			channels: [
				{
					slug: 'messages',
					label: 'Messages',
					access: { read: ({ req }) => isStaff(req), create: ({ req }) => isStaff(req) },
				},
			],
			// Kept on the message itself; `comments` above uses the default own collection.
			extensions: [
				reactions({ emojis: ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🚀', '✅'], storage: 'message' }),
			],
			hooks: { afterMention: autoReply('chat') },
			targets: { collections: { rooms: { channels: ['messages'] } } },
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
			afterNavLinks: [
				'/chat/ChatNavLink#ChatNavLink',
				'/playground/PlaygroundNavLink#PlaygroundNavLink',
			],
			views: {
				chat: {
					Component: '/chat/ChatView#ChatView',
					exact: true,
					meta: { title: 'Chat' },
					path: '/chat',
				},
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
