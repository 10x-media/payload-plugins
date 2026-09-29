import type { Config, Field, FieldAccess } from 'payload'

import type { ContentLockPluginOptions, ResolvedOptions } from '../options'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const ENTITY_SELECT = '@10x-media/content-lock/client#EntitySelect'

const notEverything = (_data: unknown, siblingData: { lockEverything?: unknown } | undefined) =>
	siblingData?.lockEverything === false

/** A raw-slug picker over collections or globals, gated by the escape hatch's access. */
const entityField = (
	name: 'collections' | 'globals',
	slugs: string[],
	access: FieldAccess | undefined
): Field => ({
	name,
	type: 'text',
	hasMany: true,
	label: labelForKey(name === 'collections' ? keys.fieldCollections : keys.fieldGlobals),
	access: access ? { create: access, read: access, update: access } : undefined,
	admin: {
		condition: notEverything,
		components: {
			Field: {
				path: ENTITY_SELECT,
				clientProps: { entity: name === 'collections' ? 'collection' : 'global', slugs },
			},
		},
	},
})

/**
 * The scope fields of a lock window. "Lock everything" is on by default;
 * turning it off reveals the groups, and with the escape hatch enabled, the
 * individual collections and globals. With neither, there is nothing to
 * choose: no scope fields, and every window locks everything.
 */
export const buildScopeFields = (
	config: Config,
	options: ResolvedOptions,
	individualSelection: ContentLockPluginOptions['individualSelection']
): Field[] => {
	const exempt = new Set(options.exempt)
	const fields: Field[] = []
	if (options.groups.length > 0) {
		fields.push({
			name: 'groups',
			type: 'select',
			hasMany: true,
			label: labelForKey(keys.fieldGroups),
			options: options.groups.map((group) => ({ value: group.key, label: group.label })),
			admin: { condition: notEverything },
		})
	}
	if (individualSelection) {
		const gate =
			typeof individualSelection === 'object' && individualSelection.access
				? individualSelection.access
				: undefined
		const access: FieldAccess | undefined = gate ? ({ req }) => gate({ req }) : undefined
		const collections = (config.collections ?? [])
			.map((collection) => collection.slug)
			.filter((slug) => !exempt.has(slug))
		const globals = (config.globals ?? [])
			.map((global) => global.slug)
			.filter((slug) => !exempt.has(slug))
		fields.push(entityField('collections', collections, access))
		fields.push(entityField('globals', globals, access))
	}
	if (fields.length === 0) {
		return []
	}
	return [
		{
			name: 'lockEverything',
			type: 'checkbox',
			defaultValue: true,
			label: labelForKey(keys.fieldLockEverything),
			admin: { description: labelForKey(keys.fieldLockEverythingDescription) },
		},
		...fields,
	]
}
