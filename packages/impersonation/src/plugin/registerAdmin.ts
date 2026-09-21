import type { CollectionConfig, Config } from 'payload'

import type { ResolvedOptions } from '../types'
import { isStartableAuthCollection } from './startable'

const ACTION = '@10x-media/impersonation/rsc#ImpersonationAction'
const PROVIDER = '@10x-media/impersonation/rsc#ImpersonationProvider'
const DOCUMENT_ACTION = '@10x-media/impersonation/client#ImpersonationDocumentButton'

export const registerAdmin = (config: Config, options: ResolvedOptions): void => {
	config.admin ??= {}
	config.admin.components ??= {}
	config.admin.components.providers = [...(config.admin.components.providers ?? []), PROVIDER]
	if (options.ui.headerAction) {
		config.admin.components.actions = [...(config.admin.components.actions ?? []), ACTION]
	}

	if (!options.ui.documentAction) {
		return
	}

	config.collections = (config.collections ?? []).map((collection) => {
		if (!isStartableAuthCollection(collection, options)) {
			return collection
		}
		return withDocumentAction(collection)
	})
}

const withDocumentAction = (collection: CollectionConfig): CollectionConfig => {
	const edit = collection.admin?.components?.edit
	const existing = (
		edit && typeof edit === 'object' && 'beforeDocumentControls' in edit
			? edit.beforeDocumentControls
			: undefined
	) as string[] | undefined

	return {
		...collection,
		admin: {
			...collection.admin,
			components: {
				...collection.admin?.components,
				edit: {
					...(typeof edit === 'object' ? edit : {}),
					beforeDocumentControls: [...(existing ?? []), DOCUMENT_ACTION],
				},
			},
		},
	}
}
