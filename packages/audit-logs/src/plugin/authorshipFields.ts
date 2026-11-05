import {
	type CollectionConfig,
	type CollectionSlug,
	type Config,
	createCreatedByField,
	createUpdatedByField,
	type Field,
	type GlobalConfig,
	type GlobalSlug,
} from 'payload'
import { fieldAffectsData } from 'payload/shared'

import { AUDIT_RELATIONSHIP_FIELD_COMPONENT } from '../fields/index'
import type { AuthorshipFieldsOptions } from '../types'

type Authorship = CollectionConfig['authorship']

/** Payload's reading of `authorship`: each field is on unless switched off. */
const authorshipEnabled = (authorship: Authorship, name: 'createdBy' | 'updatedBy'): boolean => {
	if (authorship === false) return false
	if (authorship === true || authorship === undefined) return true
	return authorship[name] !== false
}

const OVERRIDES = {
	admin: { components: { Field: AUDIT_RELATIONSHIP_FIELD_COMPONENT }, hidden: false },
}

/**
 * `fields` with Payload's `createdBy` and `updatedBy` added ahead of Payload, built by
 * its own factories so its stamping hooks and write access come along, but visible
 * and drawn by the plugin's component. Payload then sees the names taken and adds
 * nothing. A field the entity already declares under either name is left alone, and
 * so is one its `authorship` switches off.
 */
export const withAuthorshipFields = (fields: Field[], authorship: Authorship): Field[] => {
	const declared = (name: string) =>
		fields.some((field) => fieldAffectsData(field) && field.name === name)
	return [
		...fields,
		...(authorshipEnabled(authorship, 'createdBy') && !declared('createdBy')
			? [createCreatedByField({ overrides: OVERRIDES })]
			: []),
		...(authorshipEnabled(authorship, 'updatedBy') && !declared('updatedBy')
			? [createUpdatedByField({ overrides: OVERRIDES })]
			: []),
	]
}

/**
 * Applies `authorshipFields` to every collection and global it covers. Payload only
 * adds authorship when the config has an auth collection, and fills an empty
 * `relationTo` with them, so without one there is nothing to show.
 */
export const registerAuthorshipFields = (
	config: Config,
	options: AuthorshipFieldsOptions | undefined
): void => {
	if (!options) return
	if (!(config.collections ?? []).some((collection) => collection.auth)) return

	const covers = (list: string[] | undefined, slug: string) =>
		options === true || Boolean(list?.includes(slug))
	const listed = options === true ? undefined : options

	config.collections = (config.collections ?? []).map(
		(collection): CollectionConfig =>
			covers(listed?.collections, collection.slug as CollectionSlug)
				? { ...collection, fields: withAuthorshipFields(collection.fields, collection.authorship) }
				: collection
	)
	if (config.globals) {
		config.globals = config.globals.map(
			(global): GlobalConfig =>
				covers(listed?.globals, global.slug as GlobalSlug)
					? { ...global, fields: withAuthorshipFields(global.fields, global.authorship) }
					: global
		)
	}
}
