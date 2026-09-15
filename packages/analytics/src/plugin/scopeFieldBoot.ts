import type { Field, Payload } from 'payload'

/** Whether a top-level field of that name exists, looking through presentational wrappers. */
const hasField = (fields: Field[], name: string): boolean =>
	fields.some((field) => {
		if ('name' in field && field.name) {
			return field.name === name
		}
		if ('fields' in field) {
			return hasField(field.fields, name)
		}
		if ('tabs' in field) {
			return field.tabs.some(
				(tab) => !('name' in tab && tab.name) && hasField(tab.fields as Field[], name)
			)
		}
		return false
	})

export interface ValidateScopeFieldArgs {
	/** Option path quoted in the error, e.g. `goals.collection.scopeField`. */
	option: string
	slug: string
	scopeField: string
}

/**
 * Fails the boot when a `scopeField` the plugin does not own never materialized on the
 * collection. A tenant plugin registers its field after this plugin runs, so the check
 * waits for the assembled config at init rather than guessing at config time.
 */
export const validateScopeField = (payload: Payload, args: ValidateScopeFieldArgs): void => {
	const collection = payload.config.collections.find((c) => c.slug === args.slug)
	if (!collection || hasField(collection.fields, args.scopeField)) {
		return
	}
	throw new Error(
		`analytics: ${args.option} "${args.scopeField}" does not exist on ${args.slug}; register the collection with your tenant plugin or use the default scope field`
	)
}
