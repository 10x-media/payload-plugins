import type { Config } from 'payload'
import { formatAdminURL } from 'payload/shared'

import type { ResolvedOptions } from '../options'

/** Resolved through the package export map, not a file path, so the import map can find them. */
const QUEUE_VIEW = '@10x-media/dedupe/rsc#DedupeQueueView'
const MERGE_VIEW = '@10x-media/dedupe/rsc#DedupeMergeView'
const MERGES_VIEW = '@10x-media/dedupe/rsc#DedupeMergesView'
const MERGE_RECORD_VIEW = '@10x-media/dedupe/rsc#DedupeMergeRecordView'
const NAV_LINK = '@10x-media/dedupe/client#DedupeNavLink'
const MERGE_MENU_ITEM = '@10x-media/dedupe/client#MergeSelectedMenuItem'
const DUPLICATES_FIELD = '@10x-media/dedupe/client#DuplicatesField'
const CONFIRM_BUTTONS = {
	SaveButton: '@10x-media/dedupe/client#ConfirmSaveButton',
	PublishButton: '@10x-media/dedupe/client#ConfirmPublishButton',
	SaveDraftButton: '@10x-media/dedupe/client#ConfirmSaveDraftButton',
} as const

/** Name of the injected sidebar field; namespaced because it lands in the host's schema. */
export const DUPLICATES_FIELD_NAME = 'dedupeDuplicates'

/**
 * Mounts the queue, the merge screen and the merge history as admin views, a sidebar entry
 * for the queue and, when asked, one for the history, and a "Merge selected" entry in the
 * list menu of every configured collection.
 */
export const registerViews = (config: Config, options: ResolvedOptions): void => {
	if (options.view === false) return
	const { history, navLabel, path: basePath } = options.view
	const adminRoute = config.routes?.admin ?? '/admin'
	const href = formatAdminURL({ adminRoute, path: basePath })
	const historyHref = formatAdminURL({ adminRoute, path: `${basePath}/merges` })

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
				dedupeMerges: {
					Component: MERGES_VIEW,
					path: `${basePath}/merges`,
					exact: true,
				},
				dedupeMergeRecord: {
					Component: { path: MERGE_RECORD_VIEW, serverProps: { basePath } },
					path: `${basePath}/merges/:id`,
					exact: true,
				},
			},
			afterNavLinks: [
				...(config.admin?.components?.afterNavLinks ?? []),
				{
					path: NAV_LINK,
					clientProps: {
						href,
						...(navLabel !== undefined ? { label: navLabel } : {}),
						...(history ? { except: historyHref } : {}),
					},
				},
				...(history
					? [
							{
								path: NAV_LINK,
								clientProps: {
									href: historyHref,
									kind: 'history',
									...(history.navLabel !== undefined ? { label: history.navLabel } : {}),
								},
							},
						]
					: []),
			],
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

/**
 * The duplicate warnings a collection's `form` option asks for, on that collection's own
 * document form: the sidebar panel as a UI field, which stores nothing, and the save
 * button. A save button the host already set is theirs, so the plugin refuses rather than
 * replacing it.
 */
export const registerFormWarnings = (config: Config, options: ResolvedOptions): string[] => {
	const warnings: string[] = []
	const mergePath =
		options.view === false
			? null
			: formatAdminURL({
					adminRoute: config.routes?.admin ?? '/admin',
					path: `${options.view.path}/merge`,
				})
	const bySlug = new Map(options.collections.map((entry) => [entry.slug as string, entry]))
	config.collections = (config.collections ?? []).map((collection) => {
		const entry = bySlug.get(collection.slug)
		if (!entry?.match || !(entry.form.sidebar || entry.form.confirmCreate)) return collection
		const clientProps = {
			collection: collection.slug,
			paths: entry.match.fields.map((field) => field.path),
		}
		const publishedOnly =
			Boolean(typeof collection.versions === 'object' && collection.versions.drafts) && !entry.draft
		let next = collection
		if (
			entry.form.sidebar &&
			!collection.fields.some((field) => 'name' in field && field.name === DUPLICATES_FIELD_NAME)
		) {
			next = {
				...next,
				fields: [
					...next.fields,
					{
						name: DUPLICATES_FIELD_NAME,
						type: 'ui',
						admin: {
							position: 'sidebar',
							disableListColumn: true,
							components: {
								Field: {
									path: DUPLICATES_FIELD,
									clientProps: { ...clientProps, mergePath, publishedOnly },
								},
							},
						},
					},
				],
			}
		}
		if (entry.form.confirmCreate) {
			const drafts =
				typeof collection.versions === 'object' ? collection.versions.drafts : undefined
			if (typeof drafts === 'object' && drafts.autosave) {
				warnings.push(
					`dedupe: \`form.confirmCreate\` on "${collection.slug}" is skipped: autosave creates the document on the first change, before any save is clicked. The sidebar panel still works.`
				)
				return next
			}
			// A collection with drafts creates through Publish or Save draft, never Save.
			const slots = drafts
				? (['PublishButton', 'SaveDraftButton'] as const)
				: (['SaveButton'] as const)
			const edit = next.admin?.components?.edit
			for (const slot of slots) {
				if (edit?.[slot]) {
					throw new Error(
						`dedupe: "${collection.slug}" already has its own ${slot}; wrap it in \`ConfirmCreate\` instead of setting \`form.confirmCreate\``
					)
				}
			}
			next = {
				...next,
				admin: {
					...next.admin,
					components: {
						...next.admin?.components,
						edit: {
							...edit,
							...Object.fromEntries(
								slots.map((slot) => [slot, { path: CONFIRM_BUTTONS[slot], clientProps }])
							),
						},
					},
				},
			}
		}
		return next
	})
	return warnings
}
