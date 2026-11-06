import type { CollectionConfig, Config, Field, PayloadComponent } from 'payload'

import { BUILT_IN_VIEWERS, NATIVE_KINDS } from '../shared/builtInViewers'
import { createFileIconSet, type FileIconSet } from '../shared/fileIcons'
import { OPAQUE_MIMES } from '../shared/mime'
import { keys } from '../translations/keys'
import { apiRouteOf, withFileIconThumbnail } from './fileIcons'
import type { DocumentPreviewRegistry } from './registry'

/** Name of the ui field carrying the list view preview cell. */
export const COLUMN_FIELD_NAME = 'documentPreviewColumn'

const CLIENT = '@10x-media/document-preview/client'

const FILE_PREVIEW = `${CLIENT}#DocumentPreviewFilePreview`

type FilePreviewConfig = PayloadComponent | Record<string, PayloadComponent>

/**
 * The mime patterns the file panel hands to the plugin. Payload picks a
 * `filePreview` by the stored mime (exact, then `type/*`, then `*`) and
 * otherwise shows its own preview, so with `nativePreviews` the map leaves out
 * the kinds Payload already previews and covers the rest: every other built-in
 * pattern, every host viewer (which wins whatever the type), and the opaque
 * mimes, which the plugin resolves by extension. Without it, `*` takes every
 * file.
 */
const filePreviewPatterns = (
	preview: DocumentPreviewRegistry['collections'][string],
	globalViewers: DocumentPreviewRegistry['viewers']
): string[] => {
	if (!preview.nativePreviews) {
		return ['*']
	}
	const builtIn = Object.entries(BUILT_IN_VIEWERS)
		.filter(([, kind]) => !NATIVE_KINDS.has(kind))
		.map(([pattern]) => pattern)
	return [
		...new Set([
			...builtIn,
			...Object.keys(globalViewers),
			...Object.keys(preview.viewers),
			...[...OPAQUE_MIMES].filter(Boolean),
		]),
	]
}

/**
 * The collection's `filePreview` with the plugin's preview added. A component
 * the host set for every file is kept as is; a host map keeps its own entries
 * and gains the plugin's for the patterns it leaves open.
 */
const withFilePreview = (
	existing: FilePreviewConfig | undefined,
	patterns: string[]
): FilePreviewConfig => {
	const isMap = existing !== undefined && typeof existing === 'object' && !('path' in existing)
	if (existing !== undefined && !isMap) {
		return existing
	}
	const ours = Object.fromEntries(patterns.map((pattern) => [pattern, FILE_PREVIEW]))
	return { ...ours, ...(existing as Record<string, PayloadComponent> | undefined) }
}

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
		globalViewers,
		icons,
		label,
	}: {
		apiRoute: string
		globalViewers: DocumentPreviewRegistry['viewers']
		icons: FileIconSet
		label: Record<string, string>
	}
): CollectionConfig => {
	const admin = { ...collection.admin }
	let fields: Field[] = collection.fields
	const upload = typeof collection.upload === 'object' ? collection.upload : {}
	const uploadComponents = upload.admin?.components
	const filePreview = withFilePreview(
		uploadComponents?.filePreview,
		filePreviewPatterns(preview, globalViewers)
	)
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
	return {
		...collection,
		admin,
		fields,
		upload: {
			...upload,
			admin: { ...upload.admin, components: { ...uploadComponents, filePreview } },
		},
	}
}

/** Wire every enabled upload collection's file panel (and list view, when asked) to the preview. */
export const injectCollections = (config: Config, registry: DocumentPreviewRegistry): void => {
	const context = {
		apiRoute: apiRouteOf(config),
		globalViewers: registry.viewers,
		icons: createFileIconSet(registry.fileIcons),
		label: columnLabel(config),
	}
	config.collections = (config.collections ?? []).map((collection) => {
		const preview = registry.collections[collection.slug]
		return preview ? withPreview(collection, preview, context) : collection
	})
}
