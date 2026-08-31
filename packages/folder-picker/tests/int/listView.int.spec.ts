import { mongooseAdapter } from '@payloadcms/db-mongodb'
import {
	buildConfig,
	type CollectionConfig,
	type Config,
	type SanitizedCollectionConfig,
	type SanitizedConfig,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { type FolderPickerPluginOptions, folderPicker } from '../../src/index'

const LIST_VIEW = '@10x-media/folder-picker/client#FolderListView'
const OWN_VIEW = '/components/OwnListView#OwnListView'

/**
 * Collections are built per call rather than shared: `buildConfig` sanitizes in place and adds the
 * `folder` field to every folder-enabled collection, so reusing one object across builds trips
 * Payload's duplicate-field check.
 */

/** Folders on, no custom list view: the one collection the plugin should act on. */
const media = (): CollectionConfig => ({
	slug: 'media',
	folders: true,
	fields: [{ name: 'title', type: 'text' }],
})

/** Folders off: the plugin must leave the stock list view in place. */
const attachments = (): CollectionConfig => ({
	slug: 'attachments',
	fields: [{ name: 'title', type: 'text' }],
})

/** Folders on but the host already declared a list view, which must survive untouched. */
const curated = (): CollectionConfig => ({
	slug: 'curated',
	folders: true,
	admin: { components: { views: { list: { Component: OWN_VIEW } } } },
	fields: [{ name: 'title', type: 'text' }],
})

/**
 * Plugins run during config sanitization, so `buildConfig` alone exercises the whole plugin
 * without starting a database. The e2e suite covers what the swapped view then renders.
 */
const build = (
	collections: CollectionConfig[],
	folders: Config['folders'] = {},
	options: FolderPickerPluginOptions = {}
) =>
	buildConfig({
		secret: 'test-secret-not-for-prod',
		db: mongooseAdapter({ url: 'mongodb://localhost/never-connected' }),
		collections,
		folders,
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
	it('swaps the list view of a folder-enabled collection', async () => {
		const config = await build([media()])
		expect(listComponent(config, 'media')).toBe(LIST_VIEW)
	})

	it('leaves a collection without folders alone', async () => {
		const config = await build([media(), attachments()])
		expect(listComponent(config, 'attachments')).toBeUndefined()
	})

	it('never overwrites a list view the host already declared', async () => {
		const config = await build([media(), curated()])
		expect(listComponent(config, 'curated')).toBe(OWN_VIEW)
	})

	it('is a no-op when folders are disabled at the root', async () => {
		const config = await build([{ ...media(), folders: false }], false)
		expect(listComponent(config, 'media')).toBeUndefined()
	})

	it('is a no-op when the plugin is disabled', async () => {
		const config = await build([media()], {}, { disabled: true })
		expect(listComponent(config, 'media')).toBeUndefined()
	})
})
