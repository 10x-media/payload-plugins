import type { CollectionConfig } from 'payload'

/**
 * The dev app's folder tree. On Payload 4 `folders: true` makes a collection the folders
 * themselves; `collectionSpecific` adds the per-folder "allowed types" field v3 called
 * `folderType`.
 */
export const folders: CollectionConfig = {
	slug: 'folders',
	admin: { useAsTitle: 'name' },
	folders: { collectionSpecific: true },
	fields: [{ name: 'name', type: 'text', required: true }],
}
