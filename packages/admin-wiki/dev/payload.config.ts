// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fields } from '@10x-media/fields'
import { lucideAdapter } from '@10x-media/fields/icon/adapters/lucide'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { de } from '@payloadcms/translations/languages/de'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig, type CollectionConfig } from 'payload'
import { adminWiki } from '../src/index'
import { ctaBlock } from './blocks/cta'
import { heroBannerBlock } from './blocks/heroBanner'
import { statusChipBlock } from './blocks/statusChip'
import { tipBlock } from './blocks/tipBlock'
import { posts } from './collections/posts'
import { products } from './collections/products'
import { settings } from './globals/settings'
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

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/admin-wiki_e2e',
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
	blocks: [ctaBlock, heroBannerBlock],
	collections: [posts, products, users],
	globals: [settings],
	i18n: { supportedLanguages: { de, en } },
	localization: { defaultLocale: 'en', locales: ['en', 'de'] },
	// Field-adding plugins first so the wiki walker sees their fields.
	plugins: [
		fields({ icon: { adapters: [lucideAdapter()], defaultLibrary: 'lucide' } }),
		adminWiki({
			// Both forms: an object with a localized label, and the string shorthand.
			customTargets: [
				{ key: 'dashboard', label: { de: 'Übersicht', en: 'Dashboard' } },
				{ key: 'dashboard.attention', label: 'Dashboard · Needs attention' },
				'traffic',
			],
			// Exercises every editor seam: a block, an inline block, and the
			// converters function that renders what a project's own nodes look like.
			editor: {
				blocks: [{ block: tipBlock, component: '/components/TipBlock#TipBlock' }],
				converters: '/components/wikiConverters#wikiConverters',
				inlineBlocks: [{ block: statusChipBlock, component: '/components/StatusChip#StatusChip' }],
			},
			exclude: { collections: ['users'] },
			// video: { playerComponent: '/components/DevVideoPlayer#DevVideoPlayer' },
			video: true,
			// Exercises both entry points: an appended tab and the escape hatch.
			overrides: {
				pages: {
					tabs: [
						{
							label: 'Editorial',
							fields: [{ name: 'tags', type: 'text', hasMany: true }],
						},
					],
					collection: (collection) => ({
						...collection,
						fields: [
							...collection.fields,
							{
								name: 'users',
								type: 'relationship',
								relationTo: 'users',
								hasMany: true,
								admin: { position: 'sidebar' },
							},
						],
					}),
				},
			},
			triggers: {
				list: { slot: 'afterListTable' },
			},
			// Exercises all three index slots, server and client components both.
			wikiView: {
				components: {
					afterTable: ['/components/WikiSlotsClient#DevWikiFooter'],
					beforeControls: ['/components/WikiSlotsClient#DevWikiHeaderLink'],
					beforeTable: ['/components/WikiSlots#DevWikiNotice'],
				},
			},
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		components: {
			views: {
				devDashboard: {
					Component: '/components/DevDashboard#DevDashboard',
					exact: true,
					path: '/dashboard',
				},
			},
		},
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
