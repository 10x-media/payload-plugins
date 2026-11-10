import { mongooseAdapter } from '@payloadcms/db-mongodb'
import {
	buildConfig,
	type CollectionConfig,
	createFolderField,
	createTagField,
	type SanitizedCollectionConfig,
	type SanitizedConfig,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { type FolderPickerPluginOptions, folderPicker } from '../../src/index'

const LIST_VIEW = '@10x-media/folder-picker/client#FolderListView'
const OWN_VIEW = '/components/OwnListView#OwnListView'

/**
 * Collections are built per call rather than shared: `buildConfig` sanitizes in place, so reusing
 * one object across builds trips Payload's duplicate-field checks.
 */

/** The folder collection itself: on Payload 4 `folders: true` makes a collection the folders. */
const folders = (): CollectionConfig => ({
	slug: 'folders',
	folders: true,
	fields: [{ name: 'name', type: 'text' }],
})

/** A tag-style hierarchy: many values per document, nothing to browse a picker by. */
const tags = (): CollectionConfig => ({
	slug: 'tags',
	tags: true,
	fields: [{ name: 'name', type: 'text' }],
})

/** Files into folders, no custom list view: the one collection the plugin should act on. */
const media = (): CollectionConfig => ({
	slug: 'media',
	fields: [{ name: 'title', type: 'text' }, createFolderField({ relationTo: 'folders' })],
})

/** No folder field: the plugin must leave the stock list view in place. */
const attachments = (): CollectionConfig => ({
	slug: 'attachments',
	fields: [{ name: 'title', type: 'text' }],
})

/** Tagged only. */
const notes = (): CollectionConfig => ({
	slug: 'notes',
	fields: [{ name: 'title', type: 'text' }, createTagField({ relationTo: 'tags' })],
})

/** Files into folders but the host already declared a list view, which must survive untouched. */
const curated = (): CollectionConfig => ({
	slug: 'curated',
	admin: { components: { views: { list: { Component: OWN_VIEW } } } },
	fields: [{ name: 'title', type: 'text' }, createFolderField({ relationTo: 'folders' })],
})

/**
 * Plugins run during config sanitization, so `buildConfig` alone exercises the whole plugin
 * without starting a database. The e2e suite covers what the swapped view then renders.
 */
const build = (collections: CollectionConfig[], options: FolderPickerPluginOptions = {}) =>
	buildConfig({
		secret: 'test-secret-not-for-prod',
		db: mongooseAdapter({ url: 'mongodb://localhost/never-connected' }),
		collections,
		plugins: [folderPicker(options)],
		typescript: { autoGenerate: false, outputFile: '/dev/null' },
		admin: { importMap: { autoGenerate: false } },
		telemetry: false,
	})

const listComponent = (config: SanitizedConfig, slug: string): unknown => {
	const collection: SanitizedCollectionConfig | undefined = config.collections.find(
		(entry) => entry.slug === slug
	)
	return collection?.admin?.components?.views?.list?.Component
}

describe('folderPicker list view swap', () => {
	it('swaps the list view of a collection that files into folders', async () => {
		const config = await build([folders(), media()])
		expect(listComponent(config, 'media')).toBe(LIST_VIEW)
	})

	it('leaves the folder collection itself alone', async () => {
		const config = await build([folders(), media()])
		expect(listComponent(config, 'folders')).toBeUndefined()
	})

	it('leaves a collection without a folder field alone', async () => {
		const config = await build([folders(), media(), attachments()])
		expect(listComponent(config, 'attachments')).toBeUndefined()
	})

	it('leaves a collection that is only tagged alone', async () => {
		const config = await build([folders(), tags(), media(), notes()])
		expect(listComponent(config, 'notes')).toBeUndefined()
	})

	it('never overwrites a list view the host already declared', async () => {
		const config = await build([folders(), media(), curated()])
		expect(listComponent(config, 'curated')).toBe(OWN_VIEW)
	})

	it('is a no-op without a folder collection', async () => {
		const config = await build([attachments()])
		expect(listComponent(config, 'attachments')).toBeUndefined()
	})

	it('is a no-op when the plugin is disabled', async () => {
		const config = await build([folders(), media()], { disabled: true })
		expect(listComponent(config, 'media')).toBeUndefined()
	})
})
