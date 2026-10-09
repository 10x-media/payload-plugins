import type { Config } from 'payload'

import type { ResolvedOptions } from '../options'

/** Resolved through the package export map, not a file path, so the import map can find them. */
const QUEUE_VIEW = '@10x-media/dedupe/rsc#DedupeQueueView'
const MERGE_VIEW = '@10x-media/dedupe/rsc#DedupeMergeView'
const MERGE_MENU_ITEM = '@10x-media/dedupe/client#MergeSelectedMenuItem'

/**
 * Mounts the queue and the merge screen as admin views, and a "Merge selected" entry in the
 * list menu of every configured collection. A link to the queue is the host's to place.
 */
export const registerViews = (config: Config, options: ResolvedOptions): void => {
	if (options.view === false) return
	const { path: basePath } = options.view

	config.admin = {
		...config.admin,
		components: {
			...config.admin?.components,
			views: {
				...config.admin?.components?.views,
				dedupeQueue: {
					Component: { path: QUEUE_VIEW, serverProps: { basePath } },
					path: basePath,
					exact: true,
				},
				dedupeMerge: {
					Component: { path: MERGE_VIEW, serverProps: { basePath } },
					path: `${basePath}/merge`,
					exact: true,
				},
			},
		},
	}

	const targets = new Set(options.collections.map((entry) => entry.slug as string))
	config.collections = (config.collections ?? []).map((collection) => {
		if (!targets.has(collection.slug)) return collection
		return {
			...collection,
			admin: {
				...collection.admin,
				components: {
					...collection.admin?.components,
					listMenuItems: [
						...(collection.admin?.components?.listMenuItems ?? []),
						{
							path: MERGE_MENU_ITEM,
							clientProps: { basePath, maxGroupSize: options.maxGroupSize },
						},
					],
				},
			},
		}
	})
}
