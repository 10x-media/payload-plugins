import type { Config } from 'payload'

const LIST_VIEW = '@10x-media/folder-picker/client#FolderListView'

/**
 * Gives every folder-enabled collection a list view that offers folder browsing inside a list
 * drawer. Payload renders `admin.components.views.list.Component` for both the list route and the
 * drawer, so one component covers the upload field's "choose from existing" without touching the
 * upload field itself. Collections that already declare a custom list view are left alone.
 */
export const registerFolderListView = (config: Config): void => {
	if (!config.folders) {
		return
	}

	config.collections = config.collections?.map((collection) => {
		if (!collection.folders) {
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
