import type { CollectionConfig, Config, CustomComponent, Field } from 'payload'

import type { LiveListAdminOptions, PresenceProfile, ResolvedSSEOptions } from '../options'

/** List cell path resolved through the package export map by the import map. */
export const LIVE_LIST_CELL_PATH = '@10x-media/sse/client#LiveListBadge'

/** One-per-list SSE sync path resolved through the package export map. */
export const LIVE_LIST_SYNC_PATH = '@10x-media/sse/client#LiveListSync'

/** Edit-view presence chip path resolved through the package export map. */
export const DOCUMENT_PRESENCE_PATH = '@10x-media/sse/client#DocumentPresence'

/** Edit-view stale-while-dirty banner path resolved through the package export map. */
export const DOCUMENT_CONFLICT_PATH = '@10x-media/sse/client#DocumentConflict'

const LIVE_LIST_SCALAR_TYPES = new Set(['text', 'number', 'email', 'date', 'checkbox'])

const documentPresenceComponent = (
	profile: PresenceProfile
): CustomComponent<{ profile: PresenceProfile }> => ({
	clientProps: { profile },
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

const isLiveListScalar = (field: Field): boolean =>
	'type' in field && typeof field.type === 'string' && LIVE_LIST_SCALAR_TYPES.has(field.type)

/**
 * Prefer an explicit `field` option, then an `id` field, then the first named
 * scalar (`text`/`number`/`email`/`date`/`checkbox`). Non-scalars are skipped
 * so `String(cellData)` does not produce `[object Object]`.
 */
const pickLiveListTarget = (fields: Field[], liveList: LiveListAdminOptions): Field | undefined => {
	if (liveList.field) {
		const named = fields.find((field) => isNamedField(field) && field.name === liveList.field)
		if (named && isLiveListScalar(named)) return named
		return undefined
	}
	const idField = fields.find((field) => isNamedField(field) && field.name === 'id')
	if (idField && isLiveListScalar(idField)) return idField
	return fields.find((field) => isNamedField(field) && isLiveListScalar(field))
}

const withLiveList = (
	collection: CollectionConfig,
	liveList: LiveListAdminOptions
): CollectionConfig => {
	const fields = collection.fields ?? []
	const target = pickLiveListTarget(fields, liveList)
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

const withDocumentPresence = (
	collection: CollectionConfig,
	profile: PresenceProfile
): CollectionConfig => {
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
						documentPresenceComponent(profile),
					],
				},
			},
		},
	}
}

const withDocumentConflict = (collection: CollectionConfig): CollectionConfig => {
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
						{ path: DOCUMENT_CONFLICT_PATH } satisfies CustomComponent,
						...(edit.beforeDocumentControls ?? []),
					],
				},
			},
		},
	}
}

/**
 * Mount LiveListSync (one stream per list), live-list cells, document presence
 * chips, and the stale-while-dirty banner on SSE-enabled collections. No-op when
 * liveList, presence, and conflict are all off.
 *
 * Payload 3.85 has no `edit.beforeDocument` slot. DocumentConflict still
 * registers on `beforeDocumentControls` so its hooks run, then portals the
 * banner after `.doc-controls`. That slot is the fixed-height nowrap save
 * toolbar, not a page banner.
 */
export const registerAdmin = (args: { config: Config; options: ResolvedSSEOptions }): void => {
	const { config, options } = args
	const { liveList, presence, conflict } = options.admin
	if (liveList === false && !presence && !conflict) {
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
		if (liveList !== false) {
			next = withLiveList(next, liveList)
		}
		if (presence && options.presence !== false) {
			next = withDocumentPresence(next, options.presence.profile)
		}
		if (conflict) {
			next = withDocumentConflict(next)
		}
		config.collections[i] = next
	}
}
