// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { BlocksFeature, lexicalEditor } from '@payloadcms/richtext-lexical'
import { de } from '@payloadcms/translations/languages/de'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig } from 'payload'
import { undoRedo } from '../src/index'
import { drafts } from './collections/drafts'
import { localized } from './collections/localized'
import { nesting } from './collections/nesting'
import { posts } from './collections/posts'
import { tags } from './collections/tags'
import { users } from './collections/users'
import { siteSettings } from './globals/siteSettings'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

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
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/undo-redo_e2e',
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
	// Blocks inside rich text are the case where Lexical's own history and the
	// form-state history overlap most: editing a block sub-field mutates the
	// editor value from outside the editor's own undo stack.
	editor: lexicalEditor({
		features: ({ defaultFeatures }) => [
			...defaultFeatures,
			BlocksFeature({
				blocks: [
					{
						slug: 'callout',
						fields: [
							{ name: 'tone', type: 'select', options: ['info', 'warning'], defaultValue: 'info' },
							{ name: 'body', type: 'text' },
							{ name: 'points', type: 'array', fields: [{ name: 'text', type: 'text' }] },
						],
					},
				],
			}),
		],
	}),
	collections: [posts, nesting, localized, drafts, tags, users],
	globals: [siteSettings],
	i18n: { supportedLanguages: { de, en } },
	localization: { defaultLocale: 'en', locales: ['en', 'de'] },
	plugins: [
		undoRedo({
			debug: true,
			// Exercises the option surface end to end: `tags` opts out entirely,
			// `drafts` gets a short stack to make eviction easy to hit by hand, and
			// `users` keeps the controls out of the way of auth fields.
			collections: {
				tags: false,
				users: false,
				drafts: { maxHistory: 5, captureDebounce: 250 },
			},
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
