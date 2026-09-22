import type { StaticLabel } from 'payload'

/**
 * Flattens a StaticLabel to a plain string for one language. Done here rather than through
 * `@payloadcms/translations`, which this package deliberately does not depend on.
 */
export const resolveStaticLabel = (
	label: StaticLabel | undefined,
	language: string
): string | undefined => {
	if (label === undefined || typeof label === 'string') return label
	return label[language] ?? label.en ?? Object.values(label)[0]
}
