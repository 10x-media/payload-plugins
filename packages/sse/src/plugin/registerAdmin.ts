import type { CollectionConfig, Config, Field, PayloadComponent } from 'payload'

import type { ResolvedSSEOptions } from '../options'

/** List cell path resolved through the package export map by the import map. */
export const LIVE_LIST_CELL_PATH = '@10x-media/sse/client#LiveListBadge'

/** Edit-view presence chip path resolved through the package export map. */
export const DOCUMENT_PRESENCE_PATH = '@10x-media/sse/client#DocumentPresence'

const documentPresenceComponent = (): PayloadComponent<never, never> => ({
	path: DOCUMENT_PRESENCE_PATH,
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

const withLiveListCell = (collection: CollectionConfig): CollectionConfig => {
	const fields = collection.fields ?? []
	const target = pickLiveListTarget(fields)
	if (!target || !isNamedField(target)) return collection
	if (fieldHasCell(target)) return collection

	const targetName = target.name
	const nextFields: Field[] = fields.map((field) => {
		if (!isNamedField(field) || field.name !== targetName) return field
		const admin = 'admin' in field && field.admin ? field.admin : {}
		const components = 'components' in admin && admin.components ? admin.components : {}
		return {
			...field,
			admin: {
				...admin,
				components: {
					...components,
					Cell: LIVE_LIST_CELL_PATH,
				},
			},
		} as Field
	})

	return {
		...collection,
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
	if (admin === false) {
		return { liveList: false, presence: false }
	}
	const opts = admin === true || admin === undefined ? {} : admin
	return {
		liveList: opts.liveList !== false,
		presence: presenceEnabled && opts.presence !== false,
	}
}

/**
 * Mount live-list cells and document presence chips on SSE-enabled collections.
 * No-op when `options.admin === false`.
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
			next = withLiveListCell(next)
		}
		if (flags.presence) {
			next = withDocumentPresence(next)
		}
		config.collections[i] = next
	}
}
