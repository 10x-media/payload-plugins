import type { CollectionConfig, Config } from 'payload'

const LIST_VIEW = '@10x-media/folder-picker/client#FolderListView'

/**
 * Folder collections as Payload 4 builds them: `folders: true` (a hierarchy preset with single
 * parents) or a `hierarchy` with `allowHasMany: false`. Tag-style hierarchies are left out, a
 * document sits in many tags at once, so there is no single folder to browse it by.
 */
const isFolderCollection = (collection: CollectionConfig): boolean =>
	Boolean(collection.folders) ||
	(typeof collection.hierarchy === 'object' && collection.hierarchy.allowHasMany === false)

/**
 * Collections that file into a folder collection carry its relationship at the top level under
 * `_h_<folders slug>` (what `createFolderField` adds). Payload matches related collections the
 * same way when it sanitizes the hierarchy, before plugins could see a renamed field.
 */
const filesIntoFolders = (collection: CollectionConfig, folderSlugs: Set<string>): boolean =>
	collection.fields.some(
		(field) =>
			field.type === 'relationship' &&
			typeof field.relationTo === 'string' &&
			folderSlugs.has(field.relationTo) &&
			field.name === `_h_${field.relationTo}`
	)

/**
 * Gives every collection that files into a folder collection a list view that offers folder
 * browsing inside a list drawer. Payload renders `admin.components.views.list.Component` for both
 * the list route and the drawer, so one component covers the upload field's "choose from
 * existing" without touching the upload field itself. Collections that already declare a custom
 * list view are left alone.
 */
export const registerFolderListView = (config: Config): void => {
	const folderSlugs = new Set(
		(config.collections ?? []).filter(isFolderCollection).map((collection) => collection.slug)
	)
	if (folderSlugs.size === 0) {
		return
	}

	config.collections = config.collections?.map((collection) => {
		if (!filesIntoFolders(collection, folderSlugs)) {
			return collection
		}

		const views = collection.admin?.components?.views
		if (views?.list?.Component) {
			return collection
		}

		return {
			...collection,
			admin: {
				...collection.admin,
				components: {
					...collection.admin?.components,
					views: {
						...views,
						list: { ...views?.list, Component: LIST_VIEW },
					},
				},
			},
		}
	})
}
