import type { StaticLabel } from 'payload'

/**
 * Narrows the untyped `label` a custom Field component receives (via `field.label` or the
 * top-level prop) to a renderable static label, dropping functions and other non-static shapes.
 */
export const toStaticLabel = (label: unknown): StaticLabel | undefined => {
	if (typeof label === 'string') {
		return label
	}
	if (label && typeof label === 'object') {
		return label as Record<string, string>
	}
	return undefined
}
