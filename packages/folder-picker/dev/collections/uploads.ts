import path from 'node:path'
import { type CollectionConfig, createFolderField } from 'payload'

/**
 * The upload collections the picker is exercised against. Each one covers a different branch of
 * `registerFolderListView`, so the dev app proves the plugin acts and holds back in the right
 * places rather than just that it runs.
 */
const uploadsDir = (dirname: string, slug: string): string => path.resolve(dirname, 'uploads', slug)

/** Folders on, no custom list view: the plugin swaps its view in. */
export const media = (dirname: string): CollectionConfig => ({
	slug: 'media',
	upload: { staticDir: uploadsDir(dirname, 'media') },
	fields: [createFolderField({ relationTo: 'folders' })],
})

/** A second folder-enabled collection, so polymorphic fields have two tabs to switch between. */
export const files = (dirname: string): CollectionConfig => ({
	slug: 'files',
	upload: { staticDir: uploadsDir(dirname, 'files') },
	fields: [createFolderField({ relationTo: 'folders' })],
})

/** Control: uploads without folders. Its drawer must stay Payload's stock flat list. */
export const attachments = (dirname: string): CollectionConfig => ({
	slug: 'attachments',
	upload: { staticDir: uploadsDir(dirname, 'attachments') },
	fields: [],
})

/**
 * Control: folders are on, but the collection already declares its own list view. The plugin must
 * leave it alone rather than overwrite a host's deliberate customization.
 */
export const curated = (dirname: string): CollectionConfig => ({
	slug: 'curated',
	upload: { staticDir: uploadsDir(dirname, 'curated') },
	admin: {
		components: {
			views: { list: { Component: '/components/CuratedListView#CuratedListView' } },
		},
	},
	fields: [createFolderField({ relationTo: 'folders' })],
})
