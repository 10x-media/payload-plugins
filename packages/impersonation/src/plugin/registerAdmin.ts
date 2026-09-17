import type { CollectionConfig, Config } from 'payload'

import type { ResolvedOptions } from '../types'

const ACTION = '@10x-media/impersonation/rsc#ImpersonationAction'
const PROVIDER = '@10x-media/impersonation/rsc#ImpersonationProvider'
const DOCUMENT_ACTION = '@10x-media/impersonation/client#SwitchToUserMenuItem'

export const registerAdmin = (config: Config, options: ResolvedOptions): void => {
	const anyUi =
		options.ui.headerAction ||
		options.ui.bar ||
		options.ui.documentAction ||
		options.ui.recordAction

	if (anyUi) {
		config.admin ??= {}
		config.admin.components ??= {}
		config.admin.components.providers = [...(config.admin.components.providers ?? []), PROVIDER]
		if (options.ui.headerAction) {
			config.admin.components.actions = [...(config.admin.components.actions ?? []), ACTION]
		}
	}

	if (!options.ui.documentAction) {
		return
	}

	const targets = new Set(
		options.targets ??
			(config.collections ?? [])
				.filter((collection) => Boolean(collection.auth))
				.map(({ slug }) => slug)
	)

	config.collections = (config.collections ?? []).map((collection) => {
		if (!targets.has(collection.slug) || collection.slug === options.collectionSlug) {
			return collection
		}
		return withDocumentAction(collection)
	})
}

const withDocumentAction = (collection: CollectionConfig): CollectionConfig => {
	const edit = collection.admin?.components?.edit
	const existing = (
		edit && typeof edit === 'object' && 'editMenuItems' in edit ? edit.editMenuItems : undefined
	) as string[] | undefined

	return {
		...collection,
		admin: {
			...collection.admin,
			components: {
				...collection.admin?.components,
				edit: {
					...(typeof edit === 'object' ? edit : {}),
					editMenuItems: [...(existing ?? []), DOCUMENT_ACTION],
				},
			},
		},
	}
}
