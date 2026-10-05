import type { CollectionConfig, Config, Field } from 'payload'

import { createFileIconSet, type FileIconSet } from '../shared/fileIcons'
import { keys } from '../translations/keys'
import { apiRouteOf, withFileIconThumbnail } from './fileIcons'
import type { DocumentPreviewRegistry } from './registry'

/** Name of the ui field carrying the inline preview. */
export const INLINE_FIELD_NAME = 'documentPreview'

/** Name of the ui field carrying the list view preview cell. */
export const COLUMN_FIELD_NAME = 'documentPreviewColumn'

const CLIENT = '@10x-media/document-preview/client'

/**
 * The formatted filesize cell. Payload deep-merges a collection field named like
 * one of its upload fields into that field, so declaring only the Cell keeps the
 * built-in type, label, hidden and read-only settings. A Cell the collection set
 * itself wins.
 */
const withFilesizeCell = (fields: Field[]): Field[] => {
	const index = fields.findIndex((field) => 'name' in field && field.name === 'filesize')
	const existing = index === -1 ? undefined : fields[index]
	if (existing?.admin?.components && 'Cell' in existing.admin.components) {
		return fields
	}
	const cell = { components: { Cell: `${CLIENT}#DocumentPreviewFilesizeCell` } }
	if (!existing) {
		return [...fields, { name: 'filesize', type: 'number', admin: cell }]
	}
	const merged = {
		...existing,
		admin: {
			...existing.admin,
			components: { ...existing.admin?.components, ...cell.components },
		},
	} as Field
	return fields.map((field, position) => (position === index ? merged : field))
}

const assertFreeName = (collection: CollectionConfig, name: string): void => {
	if (collection.fields.some((field) => 'name' in field && field.name === name)) {
		throw new Error(
			`[document-preview] collection "${collection.slug}" already has a field named "${name}"`
		)
	}
}

/**
 * A ui field label is static (no `LabelFunction`), so the column label is the
 * per-locale record of the already merged translations, host overrides included.
 */
const columnLabel = (config: Config): Record<string, string> => {
	const [namespace = '', key = ''] = keys.column.split(':')
	const label: Record<string, string> = {}
	for (const [locale, messages] of Object.entries(config.i18n?.translations ?? {})) {
		const value = (messages as Record<string, Record<string, unknown> | undefined>)[namespace]?.[
			key
		]
		if (typeof value === 'string') {
			label[locale] = value
		}
	}
	return label
}

const withPreview = (
	collection: CollectionConfig,
	preview: DocumentPreviewRegistry['collections'][string],
	{
		apiRoute,
		icons,
		label,
	}: { apiRoute: string; icons: FileIconSet; label: Record<string, string> }
): CollectionConfig => {
	const admin = { ...collection.admin }
	let fields: Field[] = collection.fields
	if (preview.display !== 'inline') {
		const edit = { ...admin.components?.edit }
		edit.beforeDocumentControls = [
			...(edit.beforeDocumentControls ?? []),
			`${CLIENT}#DocumentPreviewButton`,
		]
		admin.components = { ...admin.components, edit }
	}
	if (preview.display !== 'drawer') {
		assertFreeName(collection, INLINE_FIELD_NAME)
		fields = [
			{
				name: INLINE_FIELD_NAME,
				type: 'ui',
				admin: {
					components: { Field: `${CLIENT}#DocumentPreviewInlineField` },
					disableListColumn: true,
				},
			},
			...fields,
		]
	}
	if (preview.listView) {
		assertFreeName(collection, COLUMN_FIELD_NAME)
		fields = [
			...fields,
			{
				name: COLUMN_FIELD_NAME,
				type: 'ui',
				label,
				admin: { components: { Cell: `${CLIENT}#DocumentPreviewCell` } },
			},
		]
		if (admin.defaultColumns) {
			admin.defaultColumns = [...admin.defaultColumns, COLUMN_FIELD_NAME]
		}
	}
	if (preview.filesizeCell) {
		fields = withFilesizeCell(fields)
	}
	if (preview.fileIcons) {
		fields = withFileIconThumbnail(fields, icons, apiRoute)
	}
	return { ...collection, admin, fields }
}

/** Wire every enabled upload collection's edit view (and list view, when asked) to the preview. */
export const injectCollections = (config: Config, registry: DocumentPreviewRegistry): void => {
	const context = {
		apiRoute: apiRouteOf(config),
		icons: createFileIconSet(registry.fileIcons),
		label: columnLabel(config),
	}
	config.collections = (config.collections ?? []).map((collection) => {
		const preview = registry.collections[collection.slug]
		return preview ? withPreview(collection, preview, context) : collection
	})
}
