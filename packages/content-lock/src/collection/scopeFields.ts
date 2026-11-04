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
 * The scope fields of a lock window, split by where they sit. The "Lock
 * everything" toggle goes to the sidebar, on by default; turning it off
 * reveals the groups in the main column, and with the escape hatch enabled, the
 * individual collections and globals under a collapsed "Advanced" (a
 * presentational collapsible, so the stored shape is unchanged). With neither,
 * there is nothing to choose: no scope fields, and every window locks
 * everything.
 */
export const buildScopeFields = (
	config: Config,
	options: ResolvedOptions,
	individualSelection: ContentLockPluginOptions['individualSelection']
): { sidebar: Field[]; main: Field[] } => {
	const exempt = new Set(options.exempt)
	const main: Field[] = []
	if (options.groups.length > 0) {
		main.push({
			name: 'groups',
			type: 'select',
			hasMany: true,
			label: labelForKey(keys.fieldGroups),
			options: options.groups.map((group) => ({ value: group.key, label: group.label })),
			admin: { condition: notEverything },
		})
	}
	if (options.customTargets.length > 0) {
		main.push({
			name: 'customTargets',
			type: 'select',
			hasMany: true,
			label: labelForKey(keys.fieldCustomTargets),
			options: options.customTargets.map((target) => ({ value: target.key, label: target.label })),
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
		main.push({
			type: 'collapsible',
			label: labelForKey(keys.fieldAdvanced),
			admin: { condition: notEverything, initCollapsed: true },
			fields: [
				entityField('collections', collections, access),
				entityField('globals', globals, access),
			],
		})
	}
	if (main.length === 0) {
		return { sidebar: [], main: [] }
	}
	return {
		sidebar: [
			{
				name: 'lockEverything',
				type: 'checkbox',
				defaultValue: true,
				label: labelForKey(keys.fieldLockEverything),
				admin: {
					position: 'sidebar',
					description: labelForKey(keys.fieldLockEverythingDescription),
				},
			},
		],
		main,
	}
}
