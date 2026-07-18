/** Separator joining AAD identifier components; banned inside any component. */
const AAD_SEPARATOR = '.'

/** Thrown when an AAD component would make the joined associated data ambiguous. */
export class InvalidAadComponentError extends Error {
	readonly component: string
	constructor(component: string) {
		super(
			`@10x-media/fields: AAD component '${component}' must not contain '${AAD_SEPARATOR}' (it would make the associated data ambiguous)`
		)
		this.name = 'InvalidAadComponentError'
		this.component = component
	}
}

/**
 * Builds the AEAD associated-data string from discrete identifier components
 * (collection/global slug, field name, locale code). Each component is rejected
 * if it contains the '.' separator: a dotted component makes the joined AAD
 * ambiguous (`a.b` + `c` is indistinguishable from `a` + `b.c`) and silently
 * weakens the cross-field / cross-collection binding. Payload sanitizes field
 * names dot-free (config sanitize throws InvalidFieldName on a dotted name); the
 * guard fails closed for slugs and locale codes if that ever changes.
 */
export const buildAad = (components: readonly string[]): string => {
	for (const component of components) {
		if (component.includes(AAD_SEPARATOR)) {
			throw new InvalidAadComponentError(component)
		}
	}
	return components.join(AAD_SEPARATOR)
}
