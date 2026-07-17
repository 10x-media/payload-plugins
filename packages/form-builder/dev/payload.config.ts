// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig, type GlobalConfig, type PayloadRequest } from 'payload'
import {
	type ConsentSourceEntry,
	consentSourcesField,
	definePollOptionSource,
	formBuilder,
} from '../src/index'
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

// Host-owned upload collection backing the plugin's file fields (uploads are bring-your-own).
const formUploads: CollectionConfig = {
	slug: 'form-uploads',
	upload: { staticDir: path.resolve(dirname, 'uploads') },
	access: { create: () => true },
	fields: [],
}

// Policy pages with drafts on: a consent proof against one of these pins the published version it
// was agreed to.
const legalPages: CollectionConfig = {
	slug: 'legal-pages',
	admin: { useAsTitle: 'title' },
	versions: { drafts: true },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true },
	],
}

// The same idea without versions, proving the other half: proofs stay id-based and carry no
// versionRef at all rather than a fabricated one.
const notices: CollectionConfig = {
	slug: 'notices',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true },
	],
}

// Where this app keeps its consent statements. Any collection or global works; a multi-tenant app
// would place the field on its tenant document and scope the resolver below by req instead.
const settings: GlobalConfig = {
	slug: 'settings',
	fields: [consentSourcesField({ relationTo: ['legal-pages', 'notices'] })],
}

type ConsentSourceRow = {
	key?: string | null
	label?: string | null
	statement?: unknown
	page?: { relationTo: string; value: unknown } | null
}

/**
 * Reads the placed field back for the request's locale, mapping rows to entries. `url` is this
 * app's own routing (only the host knows how a document id becomes a public URL), while `page`
 * stays an id so a page can be renamed or re-slugged without stranding past proofs.
 */
const consentSources = async ({ req }: { req: PayloadRequest }): Promise<ConsentSourceEntry[]> => {
	const doc = await req.payload.findGlobal({ slug: 'settings', depth: 1, locale: req.locale, req })
	const rows = (doc.consentSources ?? []) as ConsentSourceRow[]
	return rows.flatMap((row): ConsentSourceEntry[] => {
		if (!row.key) {
			return []
		}
		const page = row.page
		const doc = page?.value as { id?: number | string; slug?: string } | undefined
		return [
			{
				key: row.key,
				...(row.label ? { label: row.label } : {}),
				...(row.statement != null ? { statement: row.statement } : {}),
				...(page && doc?.id != null ? { page: { relationTo: page.relationTo, id: doc.id } } : {}),
				...(doc?.slug ? { url: `/${page?.relationTo}/${doc.slug}` } : {}),
			},
		]
	})
}

// Demo option source: a sourced poll's choices and outcome come from domain data instead of
// authored options. `decidedWinner` simulates the moment the result is known, driving both the
// admin winner select and `resolvePollOutcome` auto mode.
const athletes = definePollOptionSource<{ eventId?: string; decidedWinner?: string }>({
	type: 'athletes',
	label: 'Athletes (demo)',
	config: [
		{ name: 'eventId', type: 'text' },
		{ name: 'decidedWinner', type: 'text' },
	],
	resolve: () => [
		{ label: 'Ada Lovelace', value: 'ada' },
		{ label: 'Grace Hopper', value: 'grace' },
		{ label: 'Margaret Hamilton', value: 'margaret' },
	],
	resolveOutcome: ({ config }) =>
		typeof config.decidedWinner === 'string' && config.decidedWinner.length > 0
			? config.decidedWinner
			: undefined,
})

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/form-builder_e2e',
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
	collections: [users, formUploads, legalPages, notices],
	globals: [settings],
	plugins: [
		formBuilder({
			uploads: { collection: 'form-uploads' },
			poll: { sources: { athletes } },
			consent: { sources: consentSources },
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
