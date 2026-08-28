import type { CollectionConfig, Config, CustomComponent, Field, PayloadComponent } from 'payload'

import type { ResolvedSSEOptions } from '../options'

/** List cell path resolved through the package export map by the import map. */
export const LIVE_LIST_CELL_PATH = '@10x-media/sse/client#LiveListBadge'

/** One-per-list SSE sync path resolved through the package export map. */
export const LIVE_LIST_SYNC_PATH = '@10x-media/sse/client#LiveListSync'

/** Edit-view presence chip path resolved through the package export map. */
export const DOCUMENT_PRESENCE_PATH = '@10x-media/sse/client#DocumentPresence'

const documentPresenceComponent = (): PayloadComponent<never, never> => ({
	path: DOCUMENT_PRESENCE_PATH,
})

const liveListSyncComponent = (collection: string): CustomComponent<{ collection: string }> => ({
	clientProps: { collection },
	path: LIVE_LIST_SYNC_PATH,
})

const isNamedField = (field: Field): field is Field & { name: string } =>
	'name' in field && typeof field.name === 'string'

const fieldHasCell = (field: Field): boolean => {
	if (!('admin' in field) || !field.admin?.components) return false
	return field.admin.components.Cell != null
}

/**
 * Prefer an explicit `id` field; otherwise the first named field in the
 * collection's top-level `fields` array.
 */
const pickLiveListTarget = (fields: Field[]): Field | undefined => {
	const idField = fields.find((field) => isNamedField(field) && field.name === 'id')
	if (idField) return idField
	return fields.find((field) => isNamedField(field))
}

const withLiveList = (collection: CollectionConfig): CollectionConfig => {
	const fields = collection.fields ?? []
	const target = pickLiveListTarget(fields)
	const admin = collection.admin ?? {}
	const components = admin.components ?? {}
	const hostBeforeTable = components.beforeListTable ?? []

	let nextFields = fields
	if (target && isNamedField(target) && !fieldHasCell(target)) {
		const targetName = target.name
		nextFields = fields.map((field) => {
			if (!isNamedField(field) || field.name !== targetName) return field
			const fieldAdmin = 'admin' in field && field.admin ? field.admin : {}
			const fieldComponents =
				'components' in fieldAdmin && fieldAdmin.components ? fieldAdmin.components : {}
			return {
				...field,
				admin: {
					...fieldAdmin,
					components: {
						...fieldComponents,
						Cell: LIVE_LIST_CELL_PATH,
					},
				},
			} as Field
		})
	}

	return {
		...collection,
		admin: {
			...admin,
			components: {
				...components,
				beforeListTable: [...hostBeforeTable, liveListSyncComponent(collection.slug)],
			},
		},
		fields: nextFields,
	}
}

const withDocumentPresence = (collection: CollectionConfig): CollectionConfig => {
	const admin = collection.admin ?? {}
	const components = admin.components ?? {}
	const edit = components.edit ?? {}
	return {
		...collection,
		admin: {
			...admin,
			components: {
				...components,
				edit: {
					...edit,
					beforeDocumentControls: [
						...(edit.beforeDocumentControls ?? []),
						documentPresenceComponent(),
					],
				},
			},
		},
	}
}

const resolveAdminFlags = (
	admin: ResolvedSSEOptions['admin'],
	presenceEnabled: boolean
): { liveList: boolean; presence: boolean } => {
	if (admin === false || admin === undefined) {
		return { liveList: false, presence: false }
	}
	const opts = admin === true ? {} : admin
	return {
		liveList: opts.liveList !== false,
		presence: presenceEnabled && opts.presence !== false,
	}
}

/**
 * Mount LiveListSync (one stream per list), live-list cells, and document
 * presence chips on SSE-enabled collections. No-op when `admin` is omitted or false.
 */
export const registerAdmin = (args: { config: Config; options: ResolvedSSEOptions }): void => {
	const { config, options } = args
	const flags = resolveAdminFlags(options.admin, options.presence !== false)
	if (!flags.liveList && !flags.presence) {
		return
	}

	const sourceSlugs = Object.keys(options.collections)
	config.collections ??= []
	for (let i = 0; i < config.collections.length; i++) {
		const collection = config.collections[i]
		if (!collection || !sourceSlugs.includes(collection.slug)) {
			continue
		}

		let next = collection
		if (flags.liveList) {
			next = withLiveList(next)
		}
		if (flags.presence) {
			next = withDocumentPresence(next)
		}
		config.collections[i] = next
	}
}
