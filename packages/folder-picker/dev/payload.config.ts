// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type CollectionConfig } from 'payload'
import { FolderUploadOverrideFeature, folderPicker } from '../src/index'
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

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Original',
					fields: [
						{
							name: 'uploadSingle',
							type: 'upload',
							relationTo: 'media',
						},
						{
							name: 'blocksReferences',
							type: 'blocks',
							blocks: [],
							blockReferences: ['reference_block_1', 'reference_block_2'],
						},
						{
							name: 'blocksRegular',
							type: 'blocks',
							blocks: [
								{
									slug: 'regular_block_1',
									fields: [
										{
											name: 'upload',
											type: 'upload',
											relationTo: 'media',
										},
									],
								},
								{
									slug: 'regular_block_2',
									fields: [
										{
											name: 'upload',
											type: 'upload',
											relationTo: 'media',
										},
									],
									custom: {
										disableFolderPicker: true,
									},
								},
							],
						},
						{
							name: 'uploadMultiple',
							type: 'upload',
							relationTo: 'media',
							hasMany: true,
						},
						{
							name: 'richText',
							type: 'richText',
						},
						{
							name: 'uploadWithMultipleRelationships',
							type: 'upload',
							relationTo: ['media', 'files'],
						},
						{
							name: 'uploadWithMultipleRelationshipsAndNoFolderCollection',
							type: 'upload',
							relationTo: ['media', 'files', 'filesWithoutFolder'],
						},
						{
							name: 'uploadWithMultipleRelationshipsMany',
							type: 'upload',
							relationTo: ['media', 'files'],
							hasMany: true,
						},
						{
							name: 'uploadWithMultipleRelationshipsAndNoFolderCollectionMany',
							type: 'upload',
							relationTo: ['media', 'files', 'filesWithoutFolder'],
							hasMany: true,
						},
						{
							name: 'sameButDisabledFolderPicker',
							type: 'group',
							custom: {
								disableFolderPicker: true,
							},
							fields: [
								{
									name: 'uploadWithMultipleRelationships',
									type: 'upload',
									relationTo: ['media', 'files'],
								},
								{
									name: 'uploadWithMultipleRelationshipsAndNoFolderCollection',
									type: 'upload',
									relationTo: ['media', 'files', 'filesWithoutFolder'],
								},
								{
									name: 'uploadWithMultipleRelationshipsMany',
									type: 'upload',
									relationTo: ['media', 'files'],
									hasMany: true,
								},
								{
									name: 'uploadWithMultipleRelationshipsAndNoFolderCollectionMany',
									type: 'upload',
									relationTo: ['media', 'files', 'filesWithoutFolder'],
									hasMany: true,
								},
							],
						},
					],
				},
				{
					label: 'Test 2',
					fields: [
						{
							name: 'array',
							type: 'array',
							fields: [
								{
									name: 'upload',
									type: 'upload',
									relationTo: 'media',
								},
								{
									name: 'upload2',
									type: 'upload',
									relationTo: 'media',
									hasMany: true,
								},
								{
									name: 'upload3',
									type: 'upload',
									relationTo: ['media', 'files'],
									hasMany: true,
								},
								{
									name: 'upload4',
									type: 'upload',
									relationTo: ['media', 'files', 'filesWithoutFolder'],
									hasMany: true,
								},
							],
						},
					],
				},
			],
		},
	],
}
const media: CollectionConfig = {
	slug: 'media',
	fields: [],
	folders: true,
	upload: {
		staticDir: path.resolve(dirname, 'media'),
	},
}
const files: CollectionConfig = {
	slug: 'files',
	fields: [],
	folders: true,
	upload: {
		staticDir: path.resolve(dirname, 'files'),
	},
}
const filesWithoutFolder: CollectionConfig = {
	slug: 'filesWithoutFolder',
	fields: [],
	upload: {
		staticDir: path.resolve(dirname, 'filesWithoutFolder'),
	},
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/folder-picker_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url:
					process.env.DATABASE_URI_MONGO ??
					'mongodb://localhost:37017/folder-picker_e2e?replicaSet=rs0&directConnection=true',
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db,
	collections: [users, posts, media, files, filesWithoutFolder],
	blocks: [
		{
			slug: 'reference_block_1',
			fields: [
				{
					name: 'upload',
					type: 'upload',
					relationTo: 'media',
				},
			],
		},
		{
			slug: 'reference_block_2',
			fields: [
				{
					name: 'upload',
					type: 'upload',
					relationTo: 'media',
				},
			],
			custom: {
				disableFolderPicker: true,
			},
		},
	],
	folders: {
		browseByFolder: true,
	},
	plugins: [folderPicker({})],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	editor: lexicalEditor({
		features({ defaultFeatures }) {
			return [...defaultFeatures, FolderUploadOverrideFeature()]
		},
	}),
	typescript: { autoGenerate },
	admin: {
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
