// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig, type GlobalConfig, type PayloadRequest } from 'payload'
import {
	type AnyFormFieldDefinition,
	type ConsentSourceEntry,
	consentSourcesField,
	type DepartmentEmailsResolver,
	defineFormField,
	departmentsField,
	formBuilder,
	resolveDepartmentOptions,
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

// The app's own domain data the poll draws its choices from. The `athleteVote` field type below
// holds a relationship to these records; whichever the author picks become the voteable options.
const athletes: CollectionConfig = {
	slug: 'athletes',
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'discipline', 'country'] },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'discipline', type: 'text' },
		{ name: 'country', type: 'text' },
	],
}

// Where this app keeps its consent statements and department routing addresses. Any collection or
// global works; a multi-tenant app would place these fields on its tenant document and scope the
// resolvers below by req instead.
const settings: GlobalConfig = {
	slug: 'settings',
	fields: [consentSourcesField({ relationTo: ['legal-pages', 'notices'] }), departmentsField()],
}

type ConsentSourceRow = {
	id?: string | number | null
	name?: string | null
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
	const rows = (doc.consentSources ?? []) as unknown as ConsentSourceRow[]
	return rows.map((row): ConsentSourceEntry => {
		const page = row.page
		const pageDoc = page?.value as { id?: number | string; slug?: string } | undefined
		return {
			id: String(row.id),
			...(row.name ? { name: row.name } : {}),
			...(row.statement != null ? { statement: row.statement } : {}),
			...(page && pageDoc?.id != null
				? { page: { relationTo: page.relationTo, id: pageDoc.id } }
				: {}),
			...(pageDoc?.slug ? { url: `/${page?.relationTo}/${pageDoc.slug}` } : {}),
		}
	})
}

/**
 * Reads `departmentsField()` back at `locale: 'all'` so `resolveDepartmentOptions` can apply its
 * current -> default -> next-available fallback per row, independent of Payload's own single-locale
 * fallback (which does not apply to an `'all'` read).
 */
const departmentEmails: DepartmentEmailsResolver = async ({ req }) => {
	const doc = await req.payload.findGlobal({ slug: 'settings', locale: 'all', depth: 0, req })
	return resolveDepartmentOptions({
		payload: req.payload,
		req,
		doc: doc as unknown as Record<string, unknown>,
		field: 'departmentEmails',
	})
}

/**
 * A poll-eligible field type whose choices are the athletes the author selected, not hand-authored
 * options. The `athletes` relationship holds the voteable records; `resolveOptions` turns those ids
 * into `{ value: id, label: name }` via `payload.find`. That one set backs the public voting UI, the
 * admin winner select, and results labeling, so a form can only accept and only report votes for the
 * athletes the author made voteable. This is the owner's real use case: seed many athletes, mark a
 * few voteable per form, and the manual winner picker offers exactly those.
 */
const athleteVote = defineFormField<'text'>({
	type: 'athleteVote',
	label: 'Athlete vote',
	value: 'text',
	pollEligible: true,
	config: [
		{
			name: 'athletes',
			type: 'relationship',
			relationTo: 'athletes',
			hasMany: true,
			required: true,
			label: 'Voteable athletes',
			admin: { description: 'Only these athletes can receive votes and appear as options.' },
		},
	],
	resolveOptions: async ({ instance, payload, req }) => {
		const raw = instance.athletes
		const ids = (Array.isArray(raw) ? raw : [])
			.map((entry) =>
				entry != null && typeof entry === 'object'
					? ((entry as { id?: string | number; value?: string | number }).id ??
						(entry as { value?: string | number }).value)
					: (entry as string | number)
			)
			.filter((id): id is string | number => id != null)
		if (ids.length === 0) {
			return []
		}
		const found = await payload.find({
			collection: 'athletes',
			where: { id: { in: ids } },
			depth: 0,
			overrideAccess: true,
			req,
			limit: 100,
		})
		const byId = new Map(found.docs.map((doc) => [String(doc.id), doc]))
		// Preserve the author's selection order; the `in` query returns database order.
		return ids
			.map((id) => byId.get(String(id)))
			.filter((doc): doc is NonNullable<typeof doc> => doc != null)
			.map((doc) => ({
				value: String(doc.id),
				label: typeof doc.name === 'string' ? doc.name : String(doc.id),
			}))
	},
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
	// Alphabetical by slug: athletes, form-uploads, legal-pages, notices, users. The plugin registers
	// its own `forms`/`form-submissions` collections separately.
	collections: [athletes, formUploads, legalPages, notices, users],
	globals: [settings],
	localization: { locales: ['en', 'de'], defaultLocale: 'en', fallback: true },
	plugins: [
		formBuilder({
			uploads: { collection: 'form-uploads' },
			// Cast mirrors the built-ins (see `buildDefaultFieldDefinitions`): a definition authored with
			// precise value/config generics is stored erased in the registry, so one cast per type.
			fields: { athleteVote: athleteVote as AnyFormFieldDefinition },
			consent: { sources: consentSources },
			email: { departments: departmentEmails },
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
