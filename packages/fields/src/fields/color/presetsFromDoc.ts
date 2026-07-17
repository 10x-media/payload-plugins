import type {
	CollectionSlug,
	FlattenedField,
	LabelFunction,
	PayloadRequest,
	StaticLabel,
} from 'payload'
import type { ColorPreset } from '../../types'
import { PRESET_PREFIX } from './options'

export type PresetsFromDocArgs = {
	/** Collection whose sanitized field configs supply the labels. */
	collection: CollectionSlug
	/** The fetched doc holding the color values. */
	doc: Record<string, unknown>
	/** Field names to lift; dot paths reach into groups and named tabs. */
	fields: string[]
	/** Prepended to every preset key, e.g. `${tenant.slug}/` to namespace per doc. */
	keyPrefix?: string
	req: PayloadRequest
}

/**
 * Rows, collapsibles, and unnamed tabs are already inlined by Payload's
 * flattening, so each dot segment only ever names a data field or a named
 * container (group, named tab, array) carrying nested flattenedFields.
 */
export const findNamedField = (
	fields: FlattenedField[] | undefined,
	path: string
): FlattenedField | undefined => {
	let scope = fields
	let found: FlattenedField | undefined
	for (const segment of path.split('.')) {
		found = scope?.find((field) => field.name === segment)
		if (!found) return undefined
		scope = 'flattenedFields' in found ? found.flattenedFields : undefined
	}
	return found
}

const readPath = (doc: Record<string, unknown>, path: string): unknown => {
	let value: unknown = doc
	for (const segment of path.split('.')) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
		value = (value as Record<string, unknown>)[segment]
	}
	return value
}

/**
 * Function labels resolve here with the same args Payload's own
 * `getTranslation` passes (`{ i18n, t }` from the request), since the
 * resulting preset must be a plain value. Static labels pass through untouched
 * so the admin localizes records per request language at render time.
 */
const labelForField = (field: FlattenedField, req: PayloadRequest): StaticLabel => {
	const label = field.label
	if (typeof label === 'function') {
		return label({ i18n: req.i18n, t: req.i18n.t } as Parameters<LabelFunction>[0])
	}
	if (label === undefined || label === false) return field.name
	return label
}

/**
 * Lifts individual color fields off a fetched doc into linked-mode presets, so
 * a fixed set of brand colors can live as plain fields instead of an
 * array/repeater. Each preset reuses the field's admin identity: key is
 * `keyPrefix + fieldPath` and the label is the field config's own label
 * (localized records untouched, functions resolved via `req.i18n`), keeping
 * picker chips consistent with the source document's edit view. Sanitized
 * configs humanize missing labels already, so the raw-name fallback only
 * fires for `label: false`. Missing fields and empty, non-string, or
 * `preset:` values are skipped rather than thrown so partial docs degrade to
 * fewer presets.
 */
export const presetsFromDoc = (args: PresetsFromDocArgs): ColorPreset[] => {
	const { collection, doc, fields, keyPrefix = '', req } = args
	const config = req.payload.collections[collection]?.config
	if (!config) {
		throw new Error(`presetsFromDoc: unknown collection "${collection}"`)
	}
	const presets: ColorPreset[] = []
	for (const name of fields) {
		const field = findNamedField(config.flattenedFields, name)
		if (!field) continue
		const value = readPath(doc, name)
		if (typeof value !== 'string' || value === '' || value.startsWith(PRESET_PREFIX)) continue
		presets.push({ key: `${keyPrefix}${name}`, label: labelForField(field, req), value })
	}
	return presets
}
