import { getTranslation } from '@payloadcms/translations'
import type {
	Field,
	FlattenedBlock,
	FlattenedField,
	LabelFunction,
	PayloadRequest,
	SanitizedCollectionConfig,
	StaticLabel,
} from 'payload'
import {
	fieldAffectsData,
	fieldIsVirtual,
	fieldShouldBeLocalized,
	tabHasName,
	toWords,
} from 'payload/shared'
import { blocksOf } from '../merge/compare'
import type { CollectionContext } from '../plugin/context'
import { readFieldConfig } from './fieldConfig'
import type { MergeFieldSpec, MergePolicy } from './types'

/** Fields Payload maintains itself. Never merged; the survivor keeps its own. */
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', '_status'])

/** Auth fields the survivor keeps; `email` and `username` are data and stay in the spec. */
export const AUTH_FIELDS = new Set([
	'password',
	'hash',
	'salt',
	'resetPasswordToken',
	'resetPasswordExpiration',
	'loginAttempts',
	'lockUntil',
	'sessions',
	'_verified',
	'_verificationToken',
	'enableAPIKey',
	'apiKey',
	'apiKeyIndex',
])

const UPLOAD_FIELDS = new Set([
	'filename',
	'filesize',
	'height',
	'mimeType',
	'sizes',
	'thumbnailURL',
	'url',
	'width',
	'focalX',
	'focalY',
	'prefix',
])

type SpecSource = Pick<SanitizedCollectionConfig, 'flattenedFields'> & {
	auth?: unknown
	upload?: unknown
	folders?: unknown
}

const childrenOf = (field: FlattenedField, known: Known): FlattenedField[] =>
	field.type === 'blocks'
		? blocksOf(field, known).flatMap((block) => block.flattenedFields)
		: 'flattenedFields' in field
			? field.flattenedFields
			: []

type Known = readonly FlattenedBlock[] | undefined

/** The first field below `fields` that declares a merge policy, by its path. */
const policyWithin = (fields: FlattenedField[], prefix: string, known: Known): string | null => {
	for (const field of fields) {
		const path = `${prefix}.${field.name}`
		if (readFieldConfig(field)?.policy) return path
		const found = policyWithin(childrenOf(field, known), path, known)
		if (found) return found
	}
	return null
}

/** The field is drawn by a `Field` component of its own. */
const hasComponent = (field: FlattenedField): boolean =>
	Boolean((field.admin as { components?: { Field?: unknown } } | undefined)?.components?.Field)

/** A group or list the merge takes whole: drawn as one by its own component, and not split. */
const whole = (field: FlattenedField): boolean =>
	hasComponent(field) && readFieldConfig(field)?.split !== true

const isList = (field: FlattenedField): boolean => {
	if (whole(field)) return false
	if (field.type === 'array' || field.type === 'blocks') return true
	if (
		field.type === 'relationship' ||
		field.type === 'upload' ||
		field.type === 'select' ||
		field.type === 'text' ||
		field.type === 'number'
	) {
		return field.hasMany === true
	}
	return false
}

const defaultPolicy = (field: FlattenedField, hidden: boolean): MergePolicy => {
	const declared = readFieldConfig(field)?.policy
	if (declared) return declared
	if (hidden) return 'survivor'
	return 'nonEmpty'
}

const walk = (args: {
	fields: FlattenedField[]
	prefix: string
	parentIsLocalized: boolean
	skip: Set<string>
	known: Known
	out: MergeFieldSpec[]
}): void => {
	for (const field of args.fields) {
		if (field.type === 'join') continue
		if (fieldIsVirtual(field)) continue
		// Hidden from the API: not merged. The survivor keeps its own value, and a row it takes
		// from another document keeps that row's.
		if (field.hidden === true) {
			if (readFieldConfig(field)?.policy) {
				throw new Error(
					`dedupe: field "${args.prefix ? `${args.prefix}.` : ''}${field.name}" declares a merge policy, but it is hidden from the API, which the merge leaves alone`
				)
			}
			continue
		}
		const path = args.prefix ? `${args.prefix}.${field.name}` : field.name
		if (!args.prefix && args.skip.has(field.name)) continue

		const localized = fieldShouldBeLocalized({ field, parentIsLocalized: args.parentIsLocalized })

		if ((field.type === 'group' || field.type === 'tab') && !localized && !whole(field)) {
			if (readFieldConfig(field)?.policy) {
				throw new Error(
					`dedupe: field "${path}" declares a merge policy, but a group is merged field by field; declare it on its fields`
				)
			}
			walk({ ...args, fields: field.flattenedFields, prefix: path })
			continue
		}
		const inner = policyWithin(childrenOf(field, args.known), path, args.known)
		if (inner) {
			throw new Error(
				`dedupe: field "${inner}" declares a merge policy inside rows, a localized group or a field drawn whole by its own component, which are merged whole; declare it on "${path}"`
			)
		}

		const hidden = field.admin?.hidden === true
		args.out.push({
			path,
			label: field.label,
			type: field.type === 'tab' ? 'group' : field.type,
			policy: defaultPolicy(field, hidden),
			localized,
			list: isList(field),
			hidden,
			unique: 'unique' in field && field.unique === true,
			required: 'required' in field && field.required === true,
			...('relationTo' in field && field.relationTo ? { relationTo: field.relationTo } : {}),
			component: hasComponent(field),
		})
	}
}

/**
 * The merge spec a collection gets before the host adjusts it. Rows, collapsibles and
 * unnamed tabs are already folded into `flattenedFields`; named groups and tabs become
 * path prefixes, and a localized group or tab stays one value so its locales travel
 * together. Arrays, blocks and every `hasMany` field are leaves merged as lists. A policy
 * declared on the field through `admin.custom.dedupe` replaces the type default.
 */
export const deriveSpec = (
	collection: SpecSource,
	folderField = 'folder',
	known?: Known
): MergeFieldSpec[] => {
	const skip = new Set(SYSTEM_FIELDS)
	// The folder Payload files the document in, where the collection has folders.
	if (collection.folders) skip.add(folderField)
	if (collection.auth) for (const name of AUTH_FIELDS) skip.add(name)
	if (collection.upload) for (const name of UPLOAD_FIELDS) skip.add(name)
	const out: MergeFieldSpec[] = []
	walk({
		fields: collection.flattenedFields,
		prefix: '',
		parentIsLocalized: false,
		skip,
		known,
		out,
	})
	return out
}

/**
 * Apply the host's `fields` seam and refuse a spec that names a path the schema does not
 * have, so a renamed field fails at boot instead of silently dropping its rule.
 */
export const resolveSpec = (
	derived: MergeFieldSpec[],
	compose: ((derived: MergeFieldSpec[]) => MergeFieldSpec[]) | undefined,
	slug: string
): MergeFieldSpec[] => {
	if (!compose) return derived
	const known = new Map(derived.map((spec) => [spec.path, spec]))
	const resolved = compose(derived.map((spec) => ({ ...spec })))
	for (const spec of resolved) {
		if (!known.has(spec.path)) {
			throw new Error(`dedupe: collection "${slug}" has no field at path "${spec.path}"`)
		}
	}
	return resolved
}

type Label = LabelFunction | StaticLabel

/**
 * The labels of the groups, named tabs and collapsibles each data field sits in, outermost
 * first: what the list view's filter writes before the field's own label. A list is one value
 * to the merge, so its own fields are not listed.
 */
export const labelPrefixes = (fields: Field[]): Map<string, Label[]> => {
	const out = new Map<string, Label[]>()
	const own = (label: unknown): Label[] =>
		label && typeof label !== 'boolean' ? [label as Label] : []
	const walk = (list: Field[], path: string, labels: Label[]) => {
		const at = (name: string) => (path ? `${path}.${name}` : name)
		for (const field of list) {
			if (field.type === 'tabs') {
				for (const tab of field.tabs) {
					if (tabHasName(tab)) walk(tab.fields, at(tab.name), [...labels, ...own(tab.label)])
					else walk(tab.fields, path, labels)
				}
			} else if (field.type === 'row') {
				walk(field.fields, path, labels)
			} else if (field.type === 'collapsible') {
				walk(field.fields, path, [...labels, ...own(field.label)])
			} else {
				if (fieldAffectsData(field)) out.set(at(field.name), labels)
				if (field.type === 'group') {
					const inner = fieldAffectsData(field) ? at(field.name) : path
					walk(field.fields, inner, [...labels, ...own(field.label)])
				}
			}
		}
	}
	walk(fields, '', [])
	return out
}

/**
 * A field of the spec named as the list view's filter names it: the labels it sits in and its
 * own, translated and joined, as `Customer profile > Rating > Score`.
 */
export const fullLabel = (
	path: string,
	col: Pick<CollectionContext, 'labelPrefixes' | 'specByPath'>,
	i18n: PayloadRequest['i18n']
): string => {
	const label = col.specByPath.get(path)?.label
	return [
		...(col.labelPrefixes.get(path) ?? []),
		label === false || label === undefined ? toWords(path.split('.').pop() ?? path) : label,
	]
		.map((part) => getTranslation(part, i18n))
		.filter(Boolean)
		.join(' > ')
}
