// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig } from 'payload'
import { documentPreview } from '../src/index'
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

const media: CollectionConfig = {
	slug: 'media',
	admin: { defaultColumns: ['filename', 'mimeType', 'filesize'], useAsTitle: 'filename' },
	fields: [{ name: 'alt', type: 'text' }],
	upload: { staticDir: path.resolve(dirname, 'uploads') },
}

const posts: CollectionConfig = {
	slug: 'posts',
	admin: { defaultColumns: ['title', 'cover', 'attachments'], useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'cover', type: 'upload', relationTo: 'media' },
		{ name: 'attachments', type: 'upload', hasMany: true, relationTo: 'media' },
	],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/document-preview_e2e',
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
	collections: [users, media, posts],
	plugins: [documentPreview({ collections: { media: { display: 'both', listView: true } } })],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		components: {
			afterNavLinks: ['/FileIconsNavLink#FileIconsNavLink'],
			views: {
				fileIcons: { Component: '/FileIconsView#FileIconsView', path: '/file-icons' },
			},
		},
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
