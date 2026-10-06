// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dedupe } from '@10x-media/dedupe'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { ar } from '@payloadcms/translations/languages/ar'
import { de } from '@payloadcms/translations/languages/de'
import { en } from '@payloadcms/translations/languages/en'
import { es } from '@payloadcms/translations/languages/es'
import { fr } from '@payloadcms/translations/languages/fr'
import { id } from '@payloadcms/translations/languages/id'
import { ko } from '@payloadcms/translations/languages/ko'
import { pt } from '@payloadcms/translations/languages/pt'
import { ru } from '@payloadcms/translations/languages/ru'
import { uk } from '@payloadcms/translations/languages/uk'
import { zh } from '@payloadcms/translations/languages/zh'
import { buildConfig } from 'payload'
import {
	articles,
	companies,
	customers,
	leads,
	media,
	memberships,
	notes,
	orders,
	products,
	showcases,
	specimens,
	staff,
	tenants,
	trips,
	users,
} from './collections'
import { site } from './globals/site'
import { startMemoryMongo } from './helpers/memoryDb'
import { recentAdapter } from './helpers/recentAdapter'
import { repointCustomers } from './helpers/repointCustomers'
import { DEV_EMAIL, seedDev } from './helpers/seed'
import { seedShowcase } from './helpers/seedShowcase'
import { seedStaff } from './helpers/seedStaff'
import { typesenseAdapter } from './helpers/typesenseAdapter'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

// One object for both plugins: dedupe scopes these collections by tenant and no other, so
// the `tenant` field of `staff` stays ordinary data.
const tenantCollections = {
	customers: {},
	leads: {},
	articles: {},
	companies: {},
	orders: {},
	memberships: {},
	trips: {},
	notes: {},
	specimens: {},
	products: {},
	showcases: {},
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/dedupe_e2e',
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
	collections: [
		users,
		tenants,
		companies,
		customers,
		leads,
		articles,
		orders,
		memberships,
		trips,
		notes,
		media,
		specimens,
		products,
		staff,
		showcases,
	],
	globals: [site],
	editor: lexicalEditor(),
	// Every language the plugin is translated into, to switch between on the account page.
	i18n: { supportedLanguages: { ar, de, en, es, fr, id, ko, pt, ru, uk, zh } },
	localization: { locales: ['en', 'de'], defaultLocale: 'en' },
	plugins: [
		// Before dedupe, as a host would have it: the tenant field is already on the documents.
		multiTenantPlugin({
			collections: tenantCollections,
			tenantsSlug: 'tenants',
			userHasAccessToAllTenants: () => true,
		}),
		dedupe({
			collections: {
				customers: {
					match: {
						fields: [
							{ path: 'email', weight: 45 },
							{ path: 'name', weight: 40, compare: 'text' },
							{ path: 'phone', weight: 35, compare: 'phone' },
							{ path: 'birthDate', weight: 25, compare: 'date', onDiffer: -25 },
						],
					},
					fields: (derived) =>
						derived.map((spec) =>
							spec.path === 'profile.score' ? { ...spec, policy: 'manual' } : spec
						),
				},
				leads: { absorbed: 'delete' },
				specimens: {
					match: {
						fields: [
							{ path: 'email', weight: 45 },
							{ path: 'title', weight: 55, compare: 'text' },
						],
					},
				},
				products: {
					match: {
						fields: [
							{ path: 'name', weight: 30, compare: 'text' },
							{ path: 'sku', weight: 40, compare: 'number' },
							{
								path: 'barcode',
								weight: 40,
								compare: 'number',
								toleranceType: 'quantity',
								tolerance: 10,
							},
							{ path: 'price', weight: 20, compare: 'number', tolerance: 5 },
						],
					},
				},
				showcases: {
					match: {
						fields: [
							{ path: 'email', weight: 45 },
							{ path: 'name', weight: 45, compare: 'text' },
						],
					},
				},
				// Its own adapter, whatever DEDUPE_ADAPTER puts on the others.
				staff: {
					match: {
						fields: [
							{ path: 'name', weight: 40, compare: 'text' },
							{ path: 'email', weight: 30 },
						],
					},
					adapter: () => recentAdapter,
				},
				articles: {
					match: {
						fields: [
							{ path: 'title', weight: 60, compare: 'text' },
							{ path: 'summary', weight: 40, compare: 'text' },
						],
					},
				},
			},
			multiTenancy: { collections: tenantCollections },
			...(process.env.DEDUPE_ADAPTER === 'custom' ? { adapter: () => recentAdapter } : {}),
			...(process.env.DEDUPE_ADAPTER === 'typesense'
				? {
						adapter: () =>
							typesenseAdapter({
								url: process.env.TYPESENSE_URL ?? 'http://localhost:8108',
								apiKey: process.env.TYPESENSE_API_KEY ?? 'dedupe-dev',
							}),
					}
				: {}),
			// The plugin moves no reference to a merged-in document; the host does, as here.
			hooks: {
				beforeRemove: async (args) => {
					if (args.collection === 'customers') await repointCustomers(args)
				},
			},
			// The dev app runs no job worker, so the check on save and "Scan now" run in the request.
			disableJobsQueue: true,
			// The e2e suite reads the pairs back through the REST API.
			collectionAccess: { read: ({ req }) => Boolean(req.user) },
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
		await seedShowcase(payload)
		await seedStaff(payload)
	},
	typescript: { autoGenerate },
	admin: {
		// The plugin adds no link to its views; the host places one, as here.
		components: { afterNavLinks: ['/components/DedupeNav#DedupeNav'] },
		// Any browser opens the admin signed in as the seeded admin. Payload applies it to every
		// request without a token, the API included, so it stays off unless asked for: the e2e
		// build checks that anonymous requests are refused.
		...(process.env.DEV_AUTOLOGIN === '1' ? { autoLogin: { email: DEV_EMAIL } } : {}),
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
